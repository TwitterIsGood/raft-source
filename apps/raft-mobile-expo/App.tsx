import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api, apiMultipart, completeProfile, forgotPassword, getChannel, getChannelFiles, getChannelMembers, getChannels, getDMs, getMessageContext, getMessages, getOrCreateThread, getServers, login, logoutRemote, register, sendMessage } from "./src/api";
import { bumpSessionGeneration, clearSession, getSessionGeneration, readSession, saveSession } from "./src/session";
import { registerForPush, subscribeToNotificationTap, unregisterForPush } from "./src/push";
import { createRaftSocket } from "./src/socket";
import { MessageCache } from "./src/messageCache";
import { completedCursor, isCurrentScope, sendableDraft } from "./src/behavior";
import { canClearComposerAfterSend, type ComposerSnapshot } from "./src/asyncGuards";
import { canApplyAuthResult, createAuthFieldTracker, noteAuthFieldChange, noteAuthFieldEndEditing, noteAuthFieldFocus, snapshotAuthInput } from "./src/authFlow";
import type { Channel, Message, Server } from "./src/types";
import type { MobileChannelFile } from "./src/api";
import { resolveAttachmentUrls, uploadAttachments, type Attachment, type PickedAttachment, pickAttachments } from "./src/attachments";
import { buildMentionCandidateGroups, buildStructuredMentions, findMentionTrigger, insertMentionAtCursor, type MentionCandidate, type MentionTrigger, type StructuredMention } from "./src/mentions";
import { Stage2Navigator } from "./src/screens/Stage2Navigator";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import type { ActivityInboxRow, SavedMessage, SearchResult } from "./src/stage2Api";
import { claimTask, getServerTasks, setTaskStatus, type MobileTask, type MobileTaskStatus } from "./src/stage3Api";
import type { Stage3Route } from "./src/stage3Navigation";
import { formatMessageTime, normalizeMessageCreatedAt } from "./src/messageTime";
import { firstMessageWindow, mergeLiveMessage, mergeMessageWindow } from "./src/messageWindow";
import { clearMessageAttention, createMessageAttentionState, messageAttentionCount, noteNewMessage, setMessageLatestState } from "./src/messageAttention";

const color = { ink: "#17212F", muted: "#718096", line: "#E5EAF0", bg: "#F6F8FB", blue: "#365FE8", mine: "#E8EEFF", white: "#FFFFFF" };
const displayName = (channel: Channel) => channel.type === "dm" ? channel.peerDisplayName || channel.peerName || channel.name || "私信" : channel.name || "未命名频道";
const normalize = (m: any): Message => ({
  id: m.id,
  seq: m.seq,
  channelId: m.channelId,
  senderType: m.senderType,
  senderId: m.senderId,
  senderName: m.senderName || "Raft",
  content: m.content || "",
  createdAt: normalizeMessageCreatedAt(m.createdAt),
  messageType: m.messageType,
  attachmentIds: Array.isArray(m.attachmentIds) ? m.attachmentIds.filter((id: unknown): id is string => typeof id === "string") : undefined,
  attachments: Array.isArray(m.attachments) ? m.attachments.flatMap((attachment: any) => {
    if (!attachment || typeof attachment !== "object" || typeof attachment.id !== "string" || typeof attachment.filename !== "string") return [];
    return [{ id: attachment.id, filename: attachment.filename, mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : null, sizeBytes: typeof attachment.sizeBytes === "number" ? attachment.sizeBytes : 0, thumbnailUrl: typeof attachment.thumbnailUrl === "string" ? attachment.thumbnailUrl : null, width: typeof attachment.width === "number" ? attachment.width : null, height: typeof attachment.height === "number" ? attachment.height : null }];
  }) : undefined,
  mentions: Array.isArray(m.mentions) ? m.mentions.flatMap((mention: any) => (mention && (mention.type === "user" || mention.type === "agent") && typeof mention.id === "string" && typeof mention.name === "string") ? [{ type: mention.type, id: mention.id, name: mention.name }] : []) : undefined,
});
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

type ViewMode = "servers" | "conversations" | "chat" | "stage2" | "settings";
type AuthMode = "login" | "register" | "forgot";
type ChatPanelTab = "chat" | "tasks" | "files";

const formatAttachmentSize = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : bytes > 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

const mergeChannelFiles = (current: MobileChannelFile[], incoming: MobileChannelFile[]) => {
  const byId = new Map(current.map((file) => [file.id, file]));
  for (const file of incoming) byId.set(file.id, file);
  return [...byId.values()];
};

const nextTaskStatus = (status: MobileTaskStatus): MobileTaskStatus => status === "todo" ? "in_progress" : status === "in_progress" ? "in_review" : status === "in_review" ? "done" : status === "done" ? "closed" : "todo";
const taskStatusLabel = (status: MobileTaskStatus) => status === "todo" ? "待处理" : status === "in_progress" ? "进行中" : status === "in_review" ? "待审核" : status === "done" ? "已完成" : "已关闭";
const channelFileIcon = (file: MobileChannelFile) => {
  const mimeType = file.mimeType.toLowerCase();
  if (mimeType.startsWith("image/")) return "file-image-outline" as const;
  if (mimeType.startsWith("video/")) return "file-video-outline" as const;
  if (mimeType === "application/pdf" || /\.pdf$/i.test(file.filename)) return "file-pdf-box" as const;
  if (/\.(zip|tar|gz|rar|7z)$/i.test(file.filename)) return "archive-outline" as const;
  if (mimeType.startsWith("audio/")) return "file-music-outline" as const;
  return "file-outline" as const;
};

export default function App() {
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= 768;
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileSetupRequired, setProfileSetupRequired] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [authRefresh, setAuthRefresh] = useState(0);
  const authRequestRef = useRef(0);
  const [servers, setServers] = useState<Server[]>([]);
  const [server, setServer] = useState<Server | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<Channel | null>(null);
  const [mode, setMode] = useState<ViewMode>("conversations");
  const [stage3Route, setStage3Route] = useState<Stage3Route | null>(null);
  const [chatTab, setChatTab] = useState<ChatPanelTab>("chat");
  const [channelTasks, setChannelTasks] = useState<MobileTask[]>([]);
  const [channelTasksBusy, setChannelTasksBusy] = useState(false);
  const [channelTaskMutating, setChannelTaskMutating] = useState<string | null>(null);
  const [channelPanelError, setChannelPanelError] = useState<string | null>(null);
  const [channelFiles, setChannelFiles] = useState<MobileChannelFile[]>([]);
  const [channelFilesBusy, setChannelFilesBusy] = useState(false);
  const [channelFilesNextCursor, setChannelFilesNextCursor] = useState<string | null>(null);
  const [channelFilesLoadingMore, setChannelFilesLoadingMore] = useState(false);
  const [channelFilesError, setChannelFilesError] = useState<string | null>(null);
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadOrigin, setThreadOrigin] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [messageListGeneration, setMessageListGeneration] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pickedAttachments, setPickedAttachments] = useState<PickedAttachment[]>([]);
  const [uploadedAttachments, setUploadedAttachments] = useState<Attachment[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<StructuredMention[]>([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const list = useRef<FlatList<Message>>(null);
  const activeRef = useRef<Channel | null>(null);
  const serverRef = useRef<Server | null>(null);
  const serversRef = useRef<Server[]>([]);
  const channelsRef = useRef<Channel[]>([]);
  const messageCacheRef = useRef(new MessageCache());
  const serverCursorRef = useRef(new Map<string, number>());
  const syncingServerRef = useRef(new Set<string>());
  const pendingServerSeqRef = useRef(new Map<string, number>());
  const checkedServerSeqRef = useRef(new Map<string, number>());
  const syncServerRef = useRef<(() => void) | null>(null);
  const socketRef = useRef<ReturnType<typeof createRaftSocket> | null>(null);
  const activeRequestRef = useRef(0);
  const channelFilesRequestRef = useRef(0);
  const channelFilesLoadingMoreRef = useRef(false);
  const channelTaskMutationRef = useRef(0);
  const mountedRef = useRef(true);
  const loadingOlder = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const messagesReadyRef = useRef(false);
  const messageAttentionRef = useRef(createMessageAttentionState());
  const followLatestOnContentChangeRef = useRef(false);
  const programmaticLatestScrollRef = useRef(false);
  const navigationRef = useRef<{ serverId: string; channelId: string; messageId?: string } | null>(null);
  const focusMessageRef = useRef<string | null>(null);
  const sessionEpochRef = useRef(getSessionGeneration());
  const composerOperationRef = useRef(0);
  const draftsRef = useRef<Record<string, string>>({});
  const composerSnapshotRef = useRef<{ channelId: string | null; draft: string; attachmentIds: readonly string[]; mentionKeys: readonly string[] }>({ channelId: null, draft: "", attachmentIds: [], mentionKeys: [] });
  const [notice, setNotice] = useState("");
  const profileRequestRef = useRef(0);
  // Keep an imperative copy of auth fields as well as React state.  Native
  // secure inputs can deliver the final automation keystroke just after the
  // submit press, so relying only on the render closure can submit a stale
  // password even though the field visibly contains the new value.
  const emailInputRef = useRef("");
  const passwordInputRef = useRef("");
  const emailFieldTrackerRef = useRef(createAuthFieldTracker());
  const passwordFieldTrackerRef = useRef(createAuthFieldTracker());
  const emailFieldRef = useRef<TextInput | null>(null);
  const passwordFieldRef = useRef<TextInput | null>(null);

  const draft = active ? drafts[active.id] || "" : "";
  const attachmentIds = uploadedAttachments.map((attachment) => attachment.id);
  const focusedMessage = highlightedMessageId ? messages.find((message) => message.id === highlightedMessageId) ?? null : null;
  composerSnapshotRef.current = {
    channelId: active?.id ?? null,
    draft: active ? draftsRef.current[active.id] || "" : "",
    attachmentIds,
    mentionKeys: selectedMentions.map((mention) => `${mention.type}:${mention.id}`),
  };
  const mentionGroups = useMemo(() => buildMentionCandidateGroups({ candidates: mentionCandidates, query: mentionQuery, channelMemberIds: new Set(mentionCandidates.map((candidate) => candidate.id)) }), [mentionCandidates, mentionQuery]);
  const mentionResults = mentionGroups.flat.slice(0, 8);
  const setDraft = (value: string) => {
    if (!active) return;
    draftsRef.current = { ...draftsRef.current, [active.id]: value };
    if (composerSnapshotRef.current.channelId === active.id) composerSnapshotRef.current = { ...composerSnapshotRef.current, draft: value };
    setDrafts(draftsRef.current);
  };
  const updateMentionTrigger = (content: string, cursor: number) => {
    const trigger = findMentionTrigger(content, cursor);
    setCursorPosition(cursor);
    setMentionTrigger(trigger);
    setMentionQuery(trigger?.query ?? "");
  };
  const handleDraftChange = (value: string) => {
    const previousLength = draft.length;
    const cursor = cursorPosition >= previousLength ? value.length : Math.min(cursorPosition, value.length);
    setDraft(value);
    updateMentionTrigger(value, cursor);
  };
  const clearComposerAttachments = () => {
    setPickedAttachments([]);
    setUploadedAttachments([]);
  };
  const clearAttachmentUrls = () => {
    setAttachmentUrls({});
    setPreviewAttachment(null);
    setPreviewText(null);
  };
  const scopeIsCurrent = (serverId: string, channelId: string, epoch: number) => sessionEpochRef.current === epoch && isCurrentScope({ serverId, channelId }, serverRef.current && activeRef.current ? { serverId: serverRef.current.id, channelId: activeRef.current.id } : null);
  const composerScopeIsCurrent = (serverId: string, channelId: string, epoch: number, operation: number) => composerOperationRef.current === operation && scopeIsCurrent(serverId, channelId, epoch);
  const updateMessageAttention = (next: ReturnType<typeof createMessageAttentionState>) => {
    if (next === messageAttentionRef.current) return;
    messageAttentionRef.current = next;
    setNewMessageCount(messageAttentionCount(next));
  };
  const resetMessageAttention = () => {
    followLatestOnContentChangeRef.current = false;
    programmaticLatestScrollRef.current = false;
    updateMessageAttention(clearMessageAttention());
  };
  const scrollListToLatest = () => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const scrollToLatest = () => {
    followLatestOnContentChangeRef.current = false;
    programmaticLatestScrollRef.current = true;
    updateMessageAttention(setMessageLatestState(messageAttentionRef.current, true));
    setMessageListGeneration((current) => current + 1);
  };
  const handleMessageScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // FlatList is inverted: offset 0 is the newest edge, while a larger
    // offset means the reader is browsing older history.
    const isAtLatest = event.nativeEvent.contentOffset.y <= 24;
    if (!isAtLatest && programmaticLatestScrollRef.current) return;
    if (!isAtLatest && !programmaticLatestScrollRef.current) followLatestOnContentChangeRef.current = false;
    if (isAtLatest) programmaticLatestScrollRef.current = false;
    updateMessageAttention(setMessageLatestState(messageAttentionRef.current, isAtLatest));
  };
  const handleMessageContentSizeChange = () => {
    if (!followLatestOnContentChangeRef.current) return;
    scrollListToLatest();
    setTimeout(() => {
      if (followLatestOnContentChangeRef.current && messageAttentionRef.current.isAtLatest) scrollListToLatest();
    }, 80);
  };
  useEffect(() => {
    if (!followLatestOnContentChangeRef.current || !messageAttentionRef.current.isAtLatest) return;
    // Inverted FlatList + maintainVisibleContentPosition can settle native
    // layout across more than one frame when sync delivers adjacent rows.
    const timers = [0, 80, 240, 500].map((delay) => setTimeout(() => {
      if (followLatestOnContentChangeRef.current && messageAttentionRef.current.isAtLatest) scrollListToLatest();
      if (delay === 500 && messageAttentionRef.current.isAtLatest) {
        followLatestOnContentChangeRef.current = false;
        programmaticLatestScrollRef.current = false;
      }
    }, delay));
    return () => timers.forEach(clearTimeout);
  }, [messages]);
  const open = (item: Channel, parent: Message | null = null, focusMessageId?: string) => { composerOperationRef.current += 1; focusMessageRef.current = focusMessageId ?? null; resetMessageAttention(); messagesReadyRef.current = false; messagesRef.current = []; setMessages([]); setHighlightedMessageId(null); setActive(item); activeRef.current = item; setThreadParent(parent); if (!parent) setThreadOrigin(null); setMode("chat"); setChatTab("chat"); setError(null); setUploading(false); setSending(false); clearComposerAttachments(); clearAttachmentUrls(); setSelectedMentions([]); setMentionTrigger(null); setMentionQuery(""); setCursorPosition(0); };
  const back = () => {
    if (mode === "chat" && threadParent && threadOrigin) { open(threadOrigin); return; }
    if (mode === "chat") { composerOperationRef.current += 1; resetMessageAttention(); messagesReadyRef.current = false; messagesRef.current = []; setMessages([]); setMode("conversations"); setActive(null); activeRef.current = null; setThreadParent(null); setUploading(false); setSending(false); clearComposerAttachments(); clearAttachmentUrls(); setSelectedMentions([]); setMentionTrigger(null); setMentionQuery(""); return; }
    if (mode === "stage2") { setMode("conversations"); return; }
    if (mode === "settings") { setMode("conversations"); return; }
    setMode("servers");
  };
  const openStage2Channel = async (channelId: string | undefined, messageId?: string) => {
    if (!server || !channelId) return;
    try {
      const known = channelsRef.current.find((item) => item.id === channelId);
      open(known ?? await getChannel(server.id, channelId), null, messageId);
    } catch (cause) {
      report(cause);
    }
  };
  const openStage2SearchResult = (result: SearchResult) => { void openStage2Channel(result.channelId, result.id); };
  const openStage2ActivityRow = (row: ActivityInboxRow) => { void openStage2Channel(row.kind === "thread" ? row.threadChannelId : row.channelId, row.latestActivityMessageId ?? row.lastMessageId ?? row.firstMentionMessageId ?? row.firstUnreadMessageId ?? row.parentMessageId); };
  const openStage2SavedMessage = (item: SavedMessage) => { void openStage2Channel(item.channelId, item.messageId); };
  const openStage3 = (route: Stage3Route) => { setStage3Route(route); setMode("stage2"); };
  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  useEffect(() => {
    if (mode !== "stage2") setStage3Route(null);
  }, [mode]);

  useEffect(() => {
    const epoch = sessionEpochRef.current;
    if (!server || !active || active.type === "thread") {
      setChannelTasks([]);
      setChannelTasksBusy(false);
      setChannelPanelError(null);
      return;
    }
    let cancelled = false;
    setChannelTasks([]);
    setChannelTasksBusy(true);
    setChannelPanelError(null);
    void getServerTasks(server.id).then((result) => {
      if (cancelled || !mountedRef.current || sessionEpochRef.current !== epoch) return;
      setChannelTasks((result.tasks ?? []).filter((task) => task.channelId === active.id));
    }).catch((cause) => {
      if (!cancelled && mountedRef.current && sessionEpochRef.current === epoch) setChannelPanelError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled && mountedRef.current && sessionEpochRef.current === epoch) setChannelTasksBusy(false);
    });
    return () => { cancelled = true; };
  }, [server, active]);

  useEffect(() => {
    const epoch = sessionEpochRef.current;
    const requestId = channelFilesRequestRef.current + 1;
    channelFilesRequestRef.current = requestId;
    channelFilesLoadingMoreRef.current = false;
    setChannelFiles([]);
    setChannelFilesNextCursor(null);
    setChannelFilesLoadingMore(false);
    setChannelFilesError(null);
    if (!server || !active) {
      setChannelFilesBusy(false);
      return;
    }
    let cancelled = false;
    setChannelFilesBusy(true);
    setChannelFilesError(null);
    void getChannelFiles(server.id, active.id).then((result) => {
      if (cancelled || !mountedRef.current || sessionEpochRef.current !== epoch || channelFilesRequestRef.current !== requestId) return;
      setChannelFiles((current) => mergeChannelFiles(current, result.files ?? []));
      setChannelFilesNextCursor(result.nextCursor ?? null);
    }).catch((cause) => {
      if (!cancelled && mountedRef.current && sessionEpochRef.current === epoch && channelFilesRequestRef.current === requestId) setChannelFilesError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled && mountedRef.current && sessionEpochRef.current === epoch && channelFilesRequestRef.current === requestId) setChannelFilesBusy(false);
    });
    return () => { cancelled = true; };
  }, [server, active]);

  const loadMoreChannelFiles = async () => {
    if (!server || !active || !channelFilesNextCursor || channelFilesLoadingMoreRef.current) return;
    const epoch = sessionEpochRef.current;
    const requestId = channelFilesRequestRef.current;
    const cursor = channelFilesNextCursor;
    channelFilesLoadingMoreRef.current = true;
    setChannelFilesLoadingMore(true);
    try {
      const result = await getChannelFiles(server.id, active.id, cursor);
      if (!mountedRef.current || sessionEpochRef.current !== epoch || channelFilesRequestRef.current !== requestId) return;
      setChannelFiles((current) => mergeChannelFiles(current, result.files ?? []));
      setChannelFilesNextCursor(result.nextCursor ?? null);
    } catch (cause) {
      if (mountedRef.current && sessionEpochRef.current === epoch && channelFilesRequestRef.current === requestId) setChannelFilesError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (channelFilesRequestRef.current === requestId) {
        channelFilesLoadingMoreRef.current = false;
        if (mountedRef.current && sessionEpochRef.current === epoch) setChannelFilesLoadingMore(false);
      }
    }
  };

  const mutateChannelTask = async (item: MobileTask, action: "claim" | MobileTaskStatus) => {
    if (!server || !active || active.type === "thread" || channelTaskMutating) return;
    const serverId = server.id;
    const channelId = active.id;
    const epoch = sessionEpochRef.current;
    const requestId = channelTaskMutationRef.current + 1;
    channelTaskMutationRef.current = requestId;
    setChannelTaskMutating(item.id);
    setChannelPanelError(null);
    try {
      const result = action === "claim" ? await claimTask(serverId, item.id) : await setTaskStatus(serverId, item.id, action);
      if (!mountedRef.current || sessionEpochRef.current !== epoch || channelTaskMutationRef.current !== requestId || serverRef.current?.id !== serverId || activeRef.current?.id !== channelId) return;
      setChannelTasks((current) => current.map((row) => row.id === item.id ? result.task : row));
    } catch (cause) {
      if (mountedRef.current && sessionEpochRef.current === epoch && channelTaskMutationRef.current === requestId) setChannelPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (channelTaskMutationRef.current === requestId) setChannelTaskMutating(null);
    }
  };

  const openChannelFileSource = async (file: MobileChannelFile) => {
    if (!server || !active) return;
    const serverId = server.id;
    const channelId = active.id;
    const epoch = sessionEpochRef.current;
    const operation = composerOperationRef.current;
    const isCurrent = () => mountedRef.current && composerOperationRef.current === operation && scopeIsCurrent(serverId, channelId, epoch);
    try {
      if (!isCurrent()) return;
      const sourceChannelId = file.source?.channelId || file.channelId;
      const source = sourceChannelId === channelId ? active : await getChannel(serverId, sourceChannelId);
      if (!isCurrent()) return;
      open(source, null, file.messageId);
    } catch (cause) {
      if (isCurrent()) report(cause);
    }
  };

  const downloadChannelFile = async (file: MobileChannelFile) => {
    if (!server) return;
    const serverId = server.id;
    const channelId = active?.id;
    if (!channelId) return;
    const epoch = sessionEpochRef.current;
    const operation = composerOperationRef.current;
    const isCurrent = () => mountedRef.current && composerOperationRef.current === operation && scopeIsCurrent(serverId, channelId, epoch);
    try {
      if (!isCurrent()) return;
      const result = await api<{ url?: string }>(`/api/attachments/${encodeURIComponent(file.id)}/url?disposition=attachment`, {}, serverId);
      if (!isCurrent()) return;
      if (!result.url) throw new Error("附件下载地址为空。");
      await Linking.openURL(result.url);
    } catch (cause) {
      if (isCurrent()) report(cause);
    }
  };

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    // Expo's iOS screen-orientation module owns the root view controller's
    // supported-interface mask.  The plist alone is not enough: the module
    // starts with its portrait default until the app explicitly unlocks it.
    void ScreenOrientation.unlockAsync().catch(() => {
      // Orientation support is best effort on platforms that do not expose
      // the native API (for example web); layout still follows dimensions.
    });
  }, []);

  useEffect(() => { void readSession().then(({ accessToken }) => { sessionEpochRef.current = getSessionGeneration(); setLoggedIn(Boolean(accessToken)); setReady(true); }).catch((cause) => { report(cause); setReady(true); }); }, []);
  useEffect(() => {
    if (!loggedIn) return;
    const epoch = sessionEpochRef.current;
    void getServers().then((rows) => {
      if (sessionEpochRef.current !== epoch) return;
      serversRef.current = rows;
      setServers(rows);
      setProfileSetupRequired(false);
      setServer((current) => rows.find((row) => row.id === navigationRef.current?.serverId) ?? (current && rows.some((row) => row.id === current.id) ? current : rows[0] ?? null));
    }).catch((e) => {
      if (sessionEpochRef.current !== epoch) return;
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("PROFILE_SETUP_REQUIRED")) {
        setProfileSetupRequired(true);
        setServer(null);
        setError(null);
      } else report(e);
    });
  }, [loggedIn, authRefresh]);
  useEffect(() => {
    if (!server) return;
    const epoch = sessionEpochRef.current;
    let cancelled = false;
    serverRef.current = server;
    setChannels([]);
    channelsRef.current = [];
    setActive(null);
    setUploading(false);
    setSending(false);
    clearComposerAttachments();
    setSelectedMentions([]);
    setMentionCandidates([]);
    resetMessageAttention();
    messagesReadyRef.current = false;
    messagesRef.current = [];
    activeRef.current = null;
    activeRequestRef.current += 1;
    setMode("conversations");
    void Promise.all([getChannels(server.id), getDMs(server.id)]).then(([regular, dms]) => {
      if (cancelled || sessionEpochRef.current !== epoch) return;
      const items = [...regular.filter((item) => item.joined !== false && !item.archivedAt), ...dms];
      channelsRef.current = items;
      setChannels(items);
      const target = navigationRef.current;
      if (target?.serverId === server.id) {
        const found = items.find((item) => item.id === target.channelId);
        if (found) open(found, null, target.messageId);
        else void getChannel(server.id, target.channelId).then((row) => { if (!cancelled && sessionEpochRef.current === epoch) open(row, null, target.messageId); }).catch((e) => { if (!cancelled && sessionEpochRef.current === epoch) report(e); });
        navigationRef.current = null;
      }
    }).catch((e) => { if (!cancelled && sessionEpochRef.current === epoch) report(e); });
    void registerForPush(server.id).catch(() => undefined);
    return () => { cancelled = true; };
  }, [server]);
  useEffect(() => {
    if (!server) return;
    const epoch = sessionEpochRef.current;
    let closed = false;
    const cacheMessage = (row: Message) => {
      if (closed || sessionEpochRef.current !== epoch) return;
      messageCacheRef.current.merge(server.id, [row]);
      if (!isCurrentScope({ serverId: server.id, channelId: row.channelId }, serverRef.current && activeRef.current ? { serverId: serverRef.current.id, channelId: activeRef.current.id } : null)) return;
      const current = messagesRef.current;
      const next = mergeLiveMessage(current, row);
      const newestSeq = current[0]?.seq ?? Number.NEGATIVE_INFINITY;
      const isNewNewest = !current.some((message) => message.id === row.id) && (row.seq ?? Number.NEGATIVE_INFINITY) > newestSeq;
      if (next !== current) {
        messagesRef.current = next;
        setMessages(next);
      }
      if (!messagesReadyRef.current || !isNewNewest) return;
      if (messageAttentionRef.current.isAtLatest) {
        // The reader was already at the newest edge, so follow the new row.
        followLatestOnContentChangeRef.current = true;
        programmaticLatestScrollRef.current = true;
      } else {
        updateMessageAttention(noteNewMessage(messageAttentionRef.current, row.id, true));
      }
    };
    const syncServer = async (): Promise<boolean> => {
      if (syncingServerRef.current.has(server.id)) return false;
      syncingServerRef.current.add(server.id);
      let completed = false;
      try {
        let cursor = serverCursorRef.current.get(server.id) ?? 0;
        while (!closed) {
          const rows = await import("./src/api").then(({ api }) => api<Message[]>(`/api/messages/sync?since_seq=${cursor}&limit=200`, {}, server.id));
          if (closed || sessionEpochRef.current !== epoch) return false;
          if (rows.length === 0) break;
          rows.map(normalize).forEach(cacheMessage);
          const nextCursor = Math.max(cursor, ...rows.map((row) => row.seq ?? 0));
          if (nextCursor <= cursor) break;
          cursor = nextCursor;
          serverCursorRef.current.set(server.id, cursor);
          if (rows.length < 200) break;
        }
        completed = true;
      } catch {
        // Keep the heartbeat checkpoint unchanged so the same seq retries.
      } finally { syncingServerRef.current.delete(server.id); }
      if (completed) {
        const pending = pendingServerSeqRef.current.get(server.id);
        if (pending !== undefined) {
          checkedServerSeqRef.current.set(server.id, pending);
          pendingServerSeqRef.current.delete(server.id);
        }
      }
      return completed;
    };
    syncServerRef.current = () => { void syncServer(); };
    const handle = createRaftSocket(server.id, () => serverCursorRef.current.get(server.id) ?? 0, (row) => {
      cacheMessage(normalize(row));
    }, (payload) => {
      if (typeof payload.body === "string") setNotice(payload.body);
    }, (currentSeq, hasMore) => {
      // Advance only after the server confirms the final ordered page.
      serverCursorRef.current.set(server.id, completedCursor(serverCursorRef.current.get(server.id) ?? 0, currentSeq, hasMore));
    }, (serverSeq) => {
      if (serverSeq > (checkedServerSeqRef.current.get(server.id) ?? 0)) {
        pendingServerSeqRef.current.set(server.id, Math.max(serverSeq, pendingServerSeqRef.current.get(server.id) ?? 0));
        void syncServer();
      }
    }, () => { void syncServer(); }, () => {
      if (sessionEpochRef.current !== epoch) return;
      setLoggedIn(false);
      setError("登录已失效，请重新登录");
    });
    socketRef.current = handle;
    return () => { closed = true; if (socketRef.current === handle) socketRef.current = null; syncServerRef.current = null; handle(); };
  }, [server]);
  useEffect(() => {
    if (!server || !active) return;
    const epoch = sessionEpochRef.current;
    let cancelled = false;
    const requestId = ++activeRequestRef.current;
    const serverId = server.id;
    const channelId = active.id;
    messagesReadyRef.current = false;
    messagesRef.current = [];
    setMessages([]); setHasOlder(false); setLoading(true);
    const focusMessageId = focusMessageRef.current;
    focusMessageRef.current = null;
    const load = focusMessageId
      ? getMessageContext(serverId, channelId, focusMessageId)
      : getMessages(serverId, channelId);
    void load.then((result) => {
      if (cancelled || sessionEpochRef.current !== epoch) return;
      if (!scopeIsCurrent(serverId, channelId, epoch) || requestId !== activeRequestRef.current) return;
      const rows = result.messages.map(normalize);
      const targetMessageId = focusMessageId ? ((result as Awaited<ReturnType<typeof getMessageContext>>).targetMessageId ?? focusMessageId) : null;
      if (focusMessageId) {
        // A context response is already a bounded window around the target. Keep
        // that window as the rendered data so the target stays in the first
        // render batch. Merging it into the full cache before rendering can put
        // an old target beyond FlatList's initial window and previously required
        // scrollToIndex during a mount, which crashed the iOS Simulator.
        const focusedRows = [...rows].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
        const targetPresent = focusedRows.some((message) => message.id === targetMessageId);
        if (!targetPresent) {
          messagesRef.current = [];
          setMessages([]);
          setHighlightedMessageId(null);
          setHasOlder(false);
          setLoading(false);
          setError("消息不存在或无权访问");
          return;
        }
        messageCacheRef.current.merge(serverId, focusedRows);
        messagesRef.current = focusedRows;
        setMessages(focusedRows);
      } else {
        messageCacheRef.current.merge(serverId, rows);
        const firstWindow = firstMessageWindow(rows, messageCacheRef.current.get(serverId, channelId));
        messagesRef.current = firstWindow;
        setMessages(firstWindow);
      }
      messagesReadyRef.current = true;
      updateMessageAttention(setMessageLatestState(messageAttentionRef.current, Boolean(!focusMessageId)));
      setHighlightedMessageId(targetMessageId);
      setHasOlder("hasOlder" in result ? Boolean(result.hasOlder) : rows.length >= 50 && !result.historyLimited);
      setLoading(false);
    }).catch((e) => { if (!cancelled && sessionEpochRef.current === epoch) { report(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, [server, active]);
  useEffect(() => {
    if (!server || !active) {
      setMentionCandidates([]);
      setSelectedMentions([]);
      setMentionTrigger(null);
      setMentionQuery("");
      return;
    }
    const epoch = sessionEpochRef.current;
    let cancelled = false;
    void getChannelMembers(server.id, active.id).then((result) => {
      if (cancelled || sessionEpochRef.current !== epoch) return;
      const humans = (result.humans ?? []).map((member) => ({ id: member.id, name: member.name || member.displayName || member.id, displayName: member.displayName, avatarUrl: member.avatarUrl, type: "user" as const }));
      const agents = (result.agents ?? []).map((member) => ({ id: member.id, name: member.name || member.displayName || member.id, displayName: member.displayName, avatarUrl: member.avatarUrl, type: "agent" as const }));
      setMentionCandidates([...humans, ...agents]);
    }).catch(() => {
      if (!cancelled && sessionEpochRef.current === epoch) setMentionCandidates([]);
    });
    return () => { cancelled = true; };
  }, [server, active]);
  useEffect(() => {
    if (!loggedIn) return;
    const epoch = sessionEpochRef.current;
    return subscribeToNotificationTap((payload) => {
      if (sessionEpochRef.current !== epoch) return;
      const targetServerId = payload.serverId;
      const targetChannelId = payload.channelId;
      if (typeof targetServerId !== "string" || typeof targetChannelId !== "string") return;
      const found = channelsRef.current.find((item) => item.id === targetChannelId);
      if (serverRef.current?.id === targetServerId && found) open(found);
      else if (serverRef.current?.id === targetServerId) void getChannel(targetServerId, targetChannelId).then((row) => open(row)).catch(report);
      else {
        navigationRef.current = { serverId: targetServerId, channelId: targetChannelId, messageId: typeof payload.messageId === "string" ? payload.messageId : undefined };
        const target = serversRef.current.find((item) => item.id === targetServerId);
        if (target) setServer(target);
        else void getServers().then((rows) => { if (sessionEpochRef.current !== epoch) return; serversRef.current = rows; setServers(rows); const row = rows.find((item) => item.id === targetServerId); if (row) setServer(row); });
      }
    });
  }, [loggedIn]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !serverRef.current) return;
      socketRef.current?.reconnect();
      syncServerRef.current?.();
    });
    return () => subscription.remove();
  }, []);

  const loadOlder = async () => {
    if (!server || !active || loadingOlder.current || !hasOlder || messages.length === 0) return;
    const serverId = server.id;
    const channelId = active.id;
    const requestId = activeRequestRef.current;
    const epoch = sessionEpochRef.current;
    const oldest = Math.min(...messages.map((m) => m.seq ?? Number.MAX_SAFE_INTEGER));
    if (!Number.isFinite(oldest)) return;
    loadingOlder.current = true;
    try {
      const result = await getMessages(serverId, channelId, oldest);
      const rows = result.messages.map(normalize);
      if (!scopeIsCurrent(serverId, channelId, epoch) || requestId !== activeRequestRef.current) return;
      messageCacheRef.current.merge(serverId, rows);
      if (scopeIsCurrent(serverId, channelId, epoch)) {
        const next = mergeMessageWindow(messagesRef.current, rows);
        messagesRef.current = next;
        setMessages(next);
        setHasOlder(rows.length >= 50 && !result.historyLimited);
      }
    } catch (e) { if (epoch === sessionEpochRef.current) report(e); } finally { loadingOlder.current = false; }
  };
  const switchAuth = (next: AuthMode) => { ++authRequestRef.current; void clearSession(); setAuthBusy(false); passwordInputRef.current = ""; passwordFieldTrackerRef.current = createAuthFieldTracker(); setPassword(""); setAuthMode(next); setError(null); setForgotSent(false); };
  const submitLogin = async () => {
    const requestId = ++authRequestRef.current;
    const requestMode = authMode;
    setError(null); setAuthBusy(true);
    try {
      const snapshot = snapshotAuthInput({ email: emailInputRef.current, password: passwordInputRef.current });
      const currentEmail = snapshot.email;
      const currentPassword = snapshot.password;
      if (!validEmail(currentEmail)) throw new Error("请输入有效邮箱地址。");
      if (authMode === "login" && !currentPassword) throw new Error("请输入密码。");
      if (authMode === "register" && currentPassword.length < 8) throw new Error("密码至少需要 8 个字符。");
      if (authMode === "login") { const result = await login(currentEmail, currentPassword); const isCurrent = () => canApplyAuthResult(authRequestRef.current, requestId, authMode, requestMode); if (!isCurrent()) return; await saveSession(result.accessToken, result.refreshToken, isCurrent); if (!isCurrent()) return; sessionEpochRef.current = getSessionGeneration(); setLoggedIn(true); }
      else if (authMode === "register") {
        if (!acceptedLegal) throw new Error("创建账号前需要同意服务条款并确认隐私政策。");
        const result = await register(currentEmail, currentPassword); const isCurrent = () => canApplyAuthResult(authRequestRef.current, requestId, authMode, requestMode); if (!isCurrent()) return; await saveSession(result.accessToken, result.refreshToken, isCurrent); if (!isCurrent()) return; sessionEpochRef.current = getSessionGeneration(); setLoggedIn(true);
      } else { await forgotPassword(currentEmail); if (canApplyAuthResult(authRequestRef.current, requestId, authMode, requestMode)) setForgotSent(true); }
    } catch (e) { if (canApplyAuthResult(authRequestRef.current, requestId, authMode, requestMode)) report(e); }
    finally { if (canApplyAuthResult(authRequestRef.current, requestId, authMode, requestMode)) setAuthBusy(false); }
  };
  const submitAuth = () => {
    // onChangeText is the authoritative value for the current focus session;
    // end-editing callbacks are guarded against stale native text below.
    emailFieldRef.current?.blur();
    passwordFieldRef.current?.blur();
    void submitLogin();
  };
  const submitProfileSetup = async () => {
    const name = profileName.trim();
    if (name.length < 5) { setError("用户名至少需要 5 个字符。"); return; }
    const epoch = sessionEpochRef.current;
    const requestId = ++profileRequestRef.current;
    setProfileBusy(true); setError(null);
    try {
      await completeProfile(name, profileDisplayName.trim() || name);
      if (sessionEpochRef.current !== epoch || profileRequestRef.current !== requestId) return;
      setProfileSetupRequired(false);
      setAuthRefresh((value) => value + 1);
    } catch (e) {
      if (sessionEpochRef.current === epoch && profileRequestRef.current === requestId) report(e);
    }
    finally {
      if (sessionEpochRef.current === epoch && profileRequestRef.current === requestId) setProfileBusy(false);
    }
  };
  const logout = async () => {
    ++authRequestRef.current;
    ++profileRequestRef.current;
    bumpSessionGeneration();
    sessionEpochRef.current = getSessionGeneration();
    const currentServer = server;
    try {
      if (currentServer) await unregisterForPush(currentServer.id);
    } catch (e) { report(e); }
    try { await logoutRemote(); } catch { /* local logout still clears this device */ }
    await clearSession();
    socketRef.current?.();
    socketRef.current = null;
    serverRef.current = null;
    activeRef.current = null;
    draftsRef.current = {};
    setDrafts({});
    serversRef.current = [];
    channelsRef.current = [];
    setServers([]);
    setChannels([]);
    resetMessageAttention();
    messagesReadyRef.current = false;
    messagesRef.current = [];
    setMessages([]);
    setHighlightedMessageId(null);
    pendingServerSeqRef.current.clear();
    checkedServerSeqRef.current.clear();
    messageCacheRef.current.clear();
    serverCursorRef.current.clear();
    setLoggedIn(false);
    emailInputRef.current = "";
    passwordInputRef.current = "";
    emailFieldTrackerRef.current = createAuthFieldTracker();
    passwordFieldTrackerRef.current = createAuthFieldTracker();
    setEmail("");
    setPassword("");
    setProfileSetupRequired(false);
    setProfileBusy(false);
    setProfileName("");
    setProfileDisplayName("");
    setServer(null);
    setActive(null);
    setUploading(false);
    setSending(false);
    clearComposerAttachments();
    clearAttachmentUrls();
    setSelectedMentions([]);
    setMentionCandidates([]);
  };
  const chooseAttachments = async () => {
    if (!server || !active || uploading || sending) return;
    const serverId = server.id;
    const channelId = active.id;
    const epoch = sessionEpochRef.current;
    const operation = composerOperationRef.current;
    try {
      const assets = await pickAttachments(async () => {
        const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: "*/*" });
        return result;
      }, { multiple: true });
      if (assets.length === 0) return;
      if (!composerScopeIsCurrent(serverId, channelId, epoch, operation)) return;
      const nextPicked = [...pickedAttachments, ...assets];
      if (nextPicked.length > 10) {
        throw new Error("一次最多选择 10 个附件。");
      }
      setUploading(true);
      const uploaded = await uploadAttachments({
        channelId,
        serverId,
        assets,
        request: (path, body, options) => apiMultipart(path, body, options?.serverId),
      });
      if (!composerScopeIsCurrent(serverId, channelId, epoch, operation)) return;
      setPickedAttachments(nextPicked);
      setUploadedAttachments((current) => [...current, ...uploaded]);
      setError(null);
    } catch (e) {
      if (composerScopeIsCurrent(serverId, channelId, epoch, operation)) report(e);
    } finally {
      if (composerScopeIsCurrent(serverId, channelId, epoch, operation)) setUploading(false);
    }
  };
  const chooseMention = (candidate: MentionCandidate) => {
    const insertion = insertMentionAtCursor(draft, cursorPosition, candidate);
    setDraft(insertion.content);
    setCursorPosition(insertion.cursor);
    setMentionTrigger(null);
    setMentionQuery("");
    if (insertion.mention) setSelectedMentions((current) => [...current.filter((item) => `${item.type}:${item.id}` !== `${insertion.mention?.type}:${insertion.mention?.id}`), insertion.mention as StructuredMention]);
  };
  const openAttachment = async (attachment: Attachment) => {
    if (!server || !active) return;
    const serverId = server.id;
    const channelId = active.id;
    const epoch = sessionEpochRef.current;
    const operation = composerOperationRef.current;
    try {
      const [resolved] = await resolveAttachmentUrls((path, options = {}) => api(path, {
        method: options.method,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: options.signal,
      }, options.serverId), [attachment.id], { serverId });
      if (!resolved?.url || !composerScopeIsCurrent(serverId, channelId, epoch, operation)) return;
      setAttachmentUrls((current) => ({ ...current, [attachment.id]: resolved.url }));
      if (attachment.mimeType?.startsWith("image/")) {
        setPreviewText(null);
        setPreviewAttachment(attachment);
      } else if (attachment.mimeType === "text/plain" || /\.(txt|md|csv|json)$/i.test(attachment.filename)) {
        const response = await fetch(resolved.url);
        if (!response.ok) throw new Error(`附件预览失败（${response.status}）。`);
        const text = await response.text();
        if (!composerScopeIsCurrent(serverId, channelId, epoch, operation)) return;
        setPreviewText(text);
        setPreviewAttachment(attachment);
      } else {
        await Linking.openURL(resolved.url);
      }
    } catch (e) {
      if (composerScopeIsCurrent(serverId, channelId, epoch, operation)) report(e);
    }
  };
  const submitMessage = async () => {
    const content = sendableDraft(draft);
    // The server requires a non-empty message body even when attachments are
    // present; keep the send affordance consistent with that contract.
    if (!content || !server || !active || sending || uploading) return;
    const serverId = server.id;
    const channelId = active.id;
    const epoch = sessionEpochRef.current;
    const operation = composerOperationRef.current;
    const draftBeforeSend = draftsRef.current[channelId] ?? "";
    const pendingAttachmentIds = [...attachmentIds];
    const pendingMentions = buildStructuredMentions(content, selectedMentions);
    const beforeSend: ComposerSnapshot = { draft: draftBeforeSend, attachmentIds: pendingAttachmentIds };
    const mentionKeysBeforeSend = selectedMentions.map((mention) => `${mention.type}:${mention.id}`);
    const expectedScope = { epoch, serverId, channelId };
    setSending(true); setDraft("");
    try {
      const response = await sendMessage(serverId, channelId, content, { attachmentIds: pendingAttachmentIds, mentions: pendingMentions });
      const row = normalize((response as any).message ?? response);
      if (!composerScopeIsCurrent(serverId, channelId, epoch, operation)) return;
      messageCacheRef.current.merge(serverId, [row]);
      const next = messageCacheRef.current.get(serverId, channelId);
      if (composerScopeIsCurrent(serverId, channelId, epoch, operation)) {
        messagesRef.current = next;
        setMessages(next);
        const current = composerSnapshotRef.current;
        const now: ComposerSnapshot = { draft: current.channelId === channelId ? current.draft : "", attachmentIds: current.channelId === channelId ? current.attachmentIds : [] };
        const mentionKeysUnchanged = current.channelId === channelId && mentionKeysBeforeSend.every((key, index) => key === current.mentionKeys[index]) && current.mentionKeys.length === mentionKeysBeforeSend.length;
        if (canClearComposerAfterSend(expectedScope, { epoch, serverId, channelId }, beforeSend, now) && mentionKeysUnchanged) {
          setSelectedMentions([]);
          clearComposerAttachments();
        }
      }
    }
    catch (e) {
      const current = composerSnapshotRef.current;
      const now: ComposerSnapshot = { draft: current.channelId === channelId ? current.draft : "", attachmentIds: current.channelId === channelId ? current.attachmentIds : [] };
      const mentionKeysUnchanged = current.channelId === channelId && mentionKeysBeforeSend.every((key, index) => key === current.mentionKeys[index]) && current.mentionKeys.length === mentionKeysBeforeSend.length;
      if (composerScopeIsCurrent(serverId, channelId, epoch, operation) && canClearComposerAfterSend(expectedScope, { epoch, serverId, channelId }, beforeSend, now) && mentionKeysUnchanged) setDraft(draftBeforeSend);
      if (composerScopeIsCurrent(serverId, channelId, epoch, operation)) report(e);
    }
    finally { if (composerScopeIsCurrent(serverId, channelId, epoch, operation)) setSending(false); }
  };
  const openThread = async (parent: Message) => {
    if (!server || !active || active.type === "thread") return;
    const serverId = server.id;
    const origin = active;
    try { const result = await getOrCreateThread(serverId, origin.id, parent.id); if (!isCurrentScope({ serverId, channelId: origin.id }, serverRef.current && activeRef.current ? { serverId: serverRef.current.id, channelId: activeRef.current.id } : null)) return; setThreadOrigin(origin); open({ id: result.threadChannelId, name: `回复 · ${displayName(origin)}`, type: "thread", serverId }, parent); }
    catch (e) { report(e); }
  };
  const title = useMemo(() => active ? displayName(active) : "消息", [active]);

  if (!ready) return <View style={styles.center}><ActivityIndicator color={color.blue} /></View>;
  if (!loggedIn) {
    const title = authMode === "login" ? "登录" : authMode === "register" ? "创建你的账号" : forgotSent ? "请查收邮件" : "重置密码";
    return <SafeAreaView style={styles.authShell}><StatusBar style="dark" />
      <View style={styles.authTopBar}><Image source={require("./assets/raft-logo.png")} style={styles.authLogo} resizeMode="contain" /></View>
      <KeyboardAvoidingView style={styles.authFlex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled">
          <View style={styles.authForm}>
            <Text style={styles.authTitle}>{title}</Text>
            {authMode === "forgot" && !forgotSent ? <Text style={styles.authDescription}>输入你的邮箱，我们会发送重置密码的链接。</Text> : null}
            {forgotSent ? <Text style={styles.authDescription}>如果 <Text style={styles.authStrong}>{email}</Text> 已注册，我们已发送密码重置链接。</Text> : null}
            {error ? <View style={styles.authBanner}><Text style={styles.authBannerText}>{error}</Text></View> : null}
            {!forgotSent ? <>
              <View style={styles.authField}><Text style={styles.authLabel}>邮箱</Text><TextInput ref={emailFieldRef} value={email} onFocus={() => { emailFieldTrackerRef.current = noteAuthFieldFocus(emailFieldTrackerRef.current); }} onChangeText={(value) => { emailInputRef.current = value; emailFieldTrackerRef.current = noteAuthFieldChange(emailFieldTrackerRef.current, value); setEmail(value); }} onEndEditing={(event) => { emailFieldTrackerRef.current = noteAuthFieldEndEditing(emailFieldTrackerRef.current, event.nativeEvent.text); emailInputRef.current = emailFieldTrackerRef.current.value; setEmail((current) => current === emailFieldTrackerRef.current.value ? current : emailFieldTrackerRef.current.value); }} autoCapitalize="none" keyboardType="email-address" textContentType="username" autoComplete="email" style={styles.authInput} /></View>
              {authMode !== "forgot" ? <View style={styles.authField}><Text style={styles.authLabel}>密码</Text><TextInput ref={passwordFieldRef} value={password} onFocus={() => { passwordFieldTrackerRef.current = noteAuthFieldFocus(passwordFieldTrackerRef.current); }} onChangeText={(value) => { passwordInputRef.current = value; passwordFieldTrackerRef.current = noteAuthFieldChange(passwordFieldTrackerRef.current, value); setPassword(value); }} onEndEditing={(event) => { passwordFieldTrackerRef.current = noteAuthFieldEndEditing(passwordFieldTrackerRef.current, event.nativeEvent.text); passwordInputRef.current = passwordFieldTrackerRef.current.value; setPassword((current) => current === passwordFieldTrackerRef.current.value ? current : passwordFieldTrackerRef.current.value); }} placeholder={authMode === "register" ? "至少 8 个字符" : undefined} secureTextEntry textContentType={authMode === "register" ? "newPassword" : "password"} autoComplete={authMode === "register" ? "password-new" : "password"} style={styles.authInput} /></View> : null}
              {authMode === "register" ? <Pressable style={styles.legalRow} onPress={() => setAcceptedLegal((value) => !value)}><View style={[styles.checkbox, acceptedLegal && styles.checkboxChecked]}>{acceptedLegal ? <Text style={styles.checkmark}>✓</Text> : null}</View><Text style={styles.legalText}>我同意 <Text style={styles.authLinkInline} onPress={() => void Linking.openURL("https://raft.build/terms")}>服务条款</Text> 并确认 <Text style={styles.authLinkInline} onPress={() => void Linking.openURL("https://raft.build/privacy")}>隐私政策</Text>。</Text></Pressable> : null}
              <Pressable style={[styles.authPrimary, (authBusy || (authMode === "register" && !acceptedLegal)) && styles.authDisabled]} disabled={authBusy || (authMode === "register" && !acceptedLegal)} onPress={submitAuth}><Text style={styles.authPrimaryText}>{authBusy ? authMode === "forgot" ? "发送中…" : authMode === "register" ? "创建账号中…" : "登录中…" : authMode === "forgot" ? "发送重置链接" : authMode === "register" ? "继续" : "登录"}</Text></Pressable>
            </> : null}
            {authMode === "login" ? <><Text style={styles.legalAgreement}>继续即表示你同意 <Text style={styles.authLinkInline} onPress={() => void Linking.openURL("https://raft.build/terms")}>服务条款</Text> 和 <Text style={styles.authLinkInline} onPress={() => void Linking.openURL("https://raft.build/privacy")}>隐私政策</Text>。</Text><Pressable onPress={() => switchAuth("forgot")}><Text style={styles.authLink}>忘记密码？</Text></Pressable><Text style={styles.authPrompt}>还没有账号？<Text style={styles.authLinkInline} onPress={() => switchAuth("register")}>创建一个</Text></Text></> : null}
            {authMode === "register" ? <Text style={styles.authPrompt}>已有账号？<Text style={styles.authLinkInline} onPress={() => switchAuth("login")}>登录</Text></Text> : null}
            {authMode === "forgot" ? <Pressable onPress={() => switchAuth("login")}><Text style={styles.authLink}>返回登录</Text></Pressable> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>;
  }
  if (profileSetupRequired) {
    return <SafeAreaView style={styles.authShell}><StatusBar style="dark" />
      <View style={styles.authTopBar}><Image source={require("./assets/raft-logo.png")} style={styles.authLogo} resizeMode="contain" /></View>
      <KeyboardAvoidingView style={styles.authFlex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled">
          <View style={styles.authForm}>
            <Text style={styles.authTitle}>完善你的资料</Text>
            <Text style={styles.authDescription}>首次登录需要设置一个用户名，完成后即可进入工作区。</Text>
            {error ? <View style={styles.authBanner}><Text style={styles.authBannerText}>{error}</Text></View> : null}
            <View style={styles.authField}><Text style={styles.authLabel}>用户名</Text><TextInput value={profileName} onChangeText={setProfileName} autoCapitalize="none" autoCorrect={false} style={styles.authInput} accessibilityLabel="用户名" /></View>
            <View style={styles.authField}><Text style={styles.authLabel}>显示名称（可选）</Text><TextInput value={profileDisplayName} onChangeText={setProfileDisplayName} style={styles.authInput} accessibilityLabel="显示名称" /></View>
            <Pressable style={[styles.authPrimary, (profileBusy || profileName.trim().length < 5) && styles.authDisabled]} disabled={profileBusy || profileName.trim().length < 5} onPress={() => void submitProfileSetup()}><Text style={styles.authPrimaryText}>{profileBusy ? "保存中…" : "完成设置"}</Text></Pressable>
            <Pressable onPress={() => void logout()}><Text style={styles.authLink}>退出并切换账号</Text></Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>;
  }
  const channelList = <FlatList data={channels} keyExtractor={(item) => item.id} contentContainerStyle={styles.listPad} renderItem={({ item }) => <Pressable style={styles.conversationRow} onPress={() => open(item)}><Text style={styles.rowTitle}>{item.type === "dm" ? "@" : "#"} {displayName(item)}</Text><Text style={styles.muted}>{item.type === "dm" ? "私信" : "频道"}</Text></Pressable>} ListEmptyComponent={<View style={styles.center}><Text style={styles.muted}>暂无已加入的频道或私信</Text></View>} />;
  const mobileHome = <View style={styles.mobileHome}>
    <View style={styles.mobileWorkspaceHeader}><Text style={styles.mobileWorkspaceName}>{server?.name || "Raft"}</Text><MaterialCommunityIcons name="chevron-down" size={20} color="#141111" style={styles.mobileWorkspaceChevron} /><Pressable accessibilityRole="button" accessibilityLabel="通知" onPress={() => setMode("stage2")}><MaterialCommunityIcons name="bell-outline" size={21} color="#141111" /></Pressable></View>
    <View style={styles.mobileHomeLinks}>
      <Pressable accessibilityRole="button" accessibilityLabel="搜索" style={styles.mobileHomeLink} onPress={() => setMode("stage2")}><MaterialCommunityIcons name="magnify" size={20} color="#141111" style={styles.mobileHomeIcon} /><Text style={styles.mobileHomeLinkText}>搜索</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="动态" style={styles.mobileHomeLink} onPress={() => setMode("stage2")}><MaterialCommunityIcons name="bell-outline" size={20} color="#141111" style={styles.mobileHomeIcon} /><Text style={styles.mobileHomeLinkText}>动态</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="已保存" style={styles.mobileHomeLink} onPress={() => setMode("stage2")}><MaterialCommunityIcons name="bookmark-outline" size={20} color="#141111" style={styles.mobileHomeIcon} /><Text style={styles.mobileHomeLinkText}>已保存</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Wiki" style={styles.mobileHomeLink} onPress={() => setMode("stage2")}><MaterialCommunityIcons name="book-open-outline" size={20} color="#141111" style={styles.mobileHomeIcon} /><Text style={styles.mobileHomeLinkText}>Wiki</Text></Pressable>
    </View>
    <ScrollView style={styles.mobileChannelScroll} contentContainerStyle={styles.mobileChannelContent}>
      <View style={styles.mobileSectionHeader}><Text style={styles.mobileSectionTitle}><MaterialCommunityIcons name="chevron-down" size={14} color="#141111" /> 置顶 <Text style={styles.mobileSectionCount}>0</Text></Text><MaterialCommunityIcons name="sort-variant" size={17} color="#141111" /></View><Text style={styles.mobileEmptyHint}>拖动频道或私信到此处置顶</Text>
      <View style={styles.mobileSectionHeader}><Text style={styles.mobileSectionTitle}><MaterialCommunityIcons name="chevron-down" size={14} color="#141111" /> 联合频道 <Text style={styles.mobileSectionCount}>0</Text></Text><MaterialCommunityIcons name="plus" size={17} color="#141111" /></View><Text style={styles.mobileEmptyHint}>暂时没有联合频道</Text>
      <View style={styles.mobileSectionHeader}><Text style={styles.mobileSectionTitle}><MaterialCommunityIcons name="chevron-down" size={14} color="#141111" /> 频道 <Text style={styles.mobileSectionCount}>{channels.filter((item) => item.type !== "dm").length}</Text></Text><MaterialCommunityIcons name="plus" size={17} color="#141111" /></View>
      {channels.filter((item) => item.type !== "dm").map((item) => <Pressable key={item.id} style={styles.mobileChannelRow} onPress={() => open(item)}><Text style={styles.mobileChannelName}># {displayName(item)}</Text></Pressable>)}
      <View style={styles.mobileSectionHeader}><Text style={styles.mobileSectionTitle}><MaterialCommunityIcons name="chevron-down" size={14} color="#141111" /> 私信 <Text style={styles.mobileSectionCount}>{channels.filter((item) => item.type === "dm").length}</Text></Text><MaterialCommunityIcons name="sort-variant" size={17} color="#141111" /></View>
      {channels.filter((item) => item.type === "dm").map((item) => <Pressable key={item.id} style={styles.mobileChannelRow} onPress={() => open(item)}><Text style={styles.mobileChannelName}>▣ {displayName(item)}</Text></Pressable>)}
    </ScrollView>
    <View style={styles.mobileBottomTabs}><Pressable style={styles.mobileBottomTab} onPress={() => setMode("conversations")}><MaterialCommunityIcons name="home-outline" size={18} color="#141111" /><Text style={styles.mobileBottomText}>主页</Text></Pressable><Pressable accessibilityLabel="任务" style={styles.mobileBottomTab} onPress={() => openStage3("tasks")}><MaterialCommunityIcons name="format-list-checks" size={18} color="#141111" /><Text style={styles.mobileBottomText}>任务</Text></Pressable><Pressable accessibilityLabel="成员" style={styles.mobileBottomTab} onPress={() => openStage3("members")}><MaterialCommunityIcons name="account-multiple-outline" size={18} color="#141111" /><Text style={styles.mobileBottomText}>成员</Text></Pressable><Pressable style={styles.mobileBottomTab} onPress={() => setMode("settings")}><MaterialCommunityIcons name="cog-outline" size={18} color="#141111" /><Text style={styles.mobileBottomText}>设置</Text></Pressable></View>
  </View>;
  const mainContent = <>
    {error ? <Pressable onPress={() => setError(null)} style={styles.errorBar}><Text numberOfLines={2} style={styles.error}>{error}</Text></Pressable> : null}
    {mode === "servers" ? <FlatList data={servers} keyExtractor={(item) => item.id} contentContainerStyle={styles.listPad} renderItem={({ item }) => <Pressable style={styles.conversationRow} onPress={() => { setServer(item); setMode("conversations"); }}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.muted}>{item.slug}</Text></Pressable>} /> : null}
    {mode === "conversations" ? (isWide ? <View style={styles.selectChannel}><Text style={styles.selectChannelText}>选择一个频道</Text></View> : mobileHome) : null}
    {mode === "stage2" && server ? <Stage2Navigator serverId={server.id} stage3Route={stage3Route} onOpenSearchResult={openStage2SearchResult} onOpenActivityRow={openStage2ActivityRow} onOpenSavedMessage={openStage2SavedMessage} /> : null}
    {mode === "settings" ? <SettingsScreen serverId={server?.id ?? null} onBack={back} onLogout={() => void logout()} /> : null}
    {mode === "chat" ? <>
      {!threadParent ? <View style={styles.chatTabs} accessibilityRole="tablist">
        {([ ["chat", "message-text-outline", "Chat"], ["tasks", "format-list-checks", "Tasks"], ["files", "paperclip", "Files"] ] as const).map(([tab, icon, label]) => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: chatTab === tab }} style={[styles.chatTab, chatTab === tab && styles.chatTabSelected]} onPress={() => setChatTab(tab)}><MaterialCommunityIcons name={icon} size={14} color={chatTab === tab ? "#141111" : "#718096"} /><Text style={[styles.chatTabLabel, chatTab === tab && styles.chatTabLabelSelected]}>{label}</Text></Pressable>)}
      </View> : null}
      {chatTab === "tasks" ? <View style={styles.channelPanel}><View style={styles.channelPanelHeading}><View><Text style={styles.channelPanelTitle}>此频道的任务</Text><Text style={styles.channelPanelHint}>{active ? `#${displayName(active)}` : ""}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="打开任务页面" onPress={() => openStage3("tasks")}><Text style={styles.action}>打开全部任务</Text></Pressable></View>{channelPanelError ? <Text style={styles.error}>{channelPanelError}</Text> : null}{channelTasksBusy ? <ActivityIndicator color="#141111" /> : <FlatList data={channelTasks} keyExtractor={(item) => item.id} contentContainerStyle={styles.channelPanelList} ListEmptyComponent={<Text style={styles.channelPanelHint}>此频道暂无任务。</Text>} renderItem={({ item }) => { const next = nextTaskStatus(item.status); return <View style={styles.channelTaskRow}><View style={styles.channelTaskCopy}><Text style={styles.channelTaskNumber}>task #{item.taskNumber} · {taskStatusLabel(item.status)}</Text><Text style={styles.channelTaskTitle}>{item.title}</Text>{item.description ? <Text style={styles.channelPanelHint}>{item.description}</Text> : null}<Text style={styles.channelTaskAssignee}>{item.claimedByName || "未分配"}</Text><View style={styles.channelTaskActions}>{!item.claimedById ? <Pressable accessibilityRole="button" accessibilityLabel={`认领任务 ${item.taskNumber}`} disabled={channelTaskMutating === item.id} onPress={() => void mutateChannelTask(item, "claim")}><Text style={styles.action}>{channelTaskMutating === item.id ? "处理中…" : "认领"}</Text></Pressable> : null}<Pressable accessibilityRole="button" accessibilityLabel={`任务 ${item.taskNumber} 移至 ${taskStatusLabel(next)}`} disabled={channelTaskMutating === item.id} onPress={() => void mutateChannelTask(item, next)}><Text style={styles.action}>移至 {taskStatusLabel(next)}</Text></Pressable></View></View></View>; }} />}</View>
        : chatTab === "files" ? <View style={styles.channelPanel}>
          <View style={styles.channelPanelHeading}>
            <View><Text style={styles.channelPanelTitle}>此频道的文件</Text><Text style={styles.channelPanelHint}>{active ? `频道级文件列表 · 含线程附件` : ""}</Text></View>
            <Text style={styles.channelPanelHint}>{channelFiles.length} 个文件</Text>
          </View>
          {channelFilesError ? <Text style={styles.error}>{channelFilesError}</Text> : null}
          {channelFilesBusy ? <ActivityIndicator color="#141111" /> : <FlatList
            data={channelFiles}
            keyExtractor={(file) => file.id}
            contentContainerStyle={styles.channelPanelList}
            onEndReached={loadMoreChannelFiles}
            onEndReachedThreshold={0.35}
            ListEmptyComponent={<Text style={styles.channelPanelHint}>此频道暂无附件。</Text>}
            ListFooterComponent={channelFilesLoadingMore ? <ActivityIndicator color="#141111" /> : null}
            renderItem={({ item: file }) => (
              <View style={styles.channelFileRow}>
                <View style={styles.channelFileIcon}><MaterialCommunityIcons name={channelFileIcon(file)} size={17} color="#141111" /></View>
                <View style={styles.channelFileCopy}><Pressable accessibilityRole="button" accessibilityLabel={`预览附件 ${file.filename}`} onPress={() => void openAttachment(file)}><Text style={styles.channelFileName} numberOfLines={1}>{file.filename}</Text><Text style={styles.channelPanelHint}>{file.mimeType || "附件"} · {formatAttachmentSize(file.sizeBytes)} · {file.uploader?.displayName || file.uploader?.name || "未知成员"} · {formatMessageTime(file.createdAt)}</Text></Pressable><View style={styles.channelFileActions}><Pressable accessibilityRole="button" accessibilityLabel={`定位附件来源 ${file.filename}`} onPress={() => void openChannelFileSource(file)}><Text style={styles.action}>定位消息</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`下载附件 ${file.filename}`} onPress={() => void downloadChannelFile(file)}><Text style={styles.action}>下载</Text></Pressable></View></View>
                <Pressable accessibilityRole="button" accessibilityLabel={`预览附件 ${file.filename}`} onPress={() => void openAttachment(file)}><MaterialCommunityIcons name="open-in-new" size={16} color="#141111" /></Pressable>
              </View>
            )}
          />}
        </View>
        : <KeyboardAvoidingView style={styles.chat} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
        {threadParent ? <View style={styles.threadParent}><Text style={styles.muted}>回复 {threadParent.senderName}</Text><Text numberOfLines={2}>{threadParent.content}</Text></View> : null}
        {focusedMessage ? <View style={styles.focusedMessageCard} accessibilityLabel={`已定位消息 ${focusedMessage.content}`}><Text style={styles.focusedMessageLabel}>已定位消息</Text><Text style={styles.sender}>{focusedMessage.senderName}</Text><Text style={styles.content}>{focusedMessage.content}</Text></View> : null}
        <FlatList key={messageListGeneration} ref={list} inverted data={messages} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.messages} renderItem={({ item }) => <Pressable accessible={false} style={[styles.messageRow, highlightedMessageId === item.id && styles.highlightedMessageRow]} onPress={() => void openThread(item)}>
          <View style={styles.messageAvatar}><Text style={styles.messageAvatarText}>{(item.senderName || "R").trim().slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.messageBody}><View style={styles.messageHeader}><Text style={styles.sender}>{item.senderName}</Text><Text style={styles.time}>{formatMessageTime(item.createdAt)}</Text></View><Text style={styles.content}>{item.content}</Text>{item.attachments?.map((attachment) => <Pressable key={attachment.id} style={styles.attachmentRow} accessibilityLabel={`打开附件 ${attachment.filename} · 消息 ${item.content}`} onPress={() => void openAttachment(attachment)}><MaterialCommunityIcons name="paperclip" size={14} color="#141111" /><View style={styles.attachmentCopy}><Text style={styles.attachmentLabel}>{attachment.filename}</Text><Text style={styles.muted}>{attachment.mimeType || "附件"} · 点按打开</Text></View></Pressable>)}{item.mentions?.length ? <Text style={styles.mentionSummary}>提及：{item.mentions.map((mention) => `@${mention.name}`).join(" ")}</Text> : null}</View>
        </Pressable>} onScroll={handleMessageScroll} onContentSizeChange={handleMessageContentSizeChange} scrollEventThrottle={100} onEndReached={() => void loadOlder()} onEndReachedThreshold={0.3} ListFooterComponent={loading ? <ActivityIndicator color="#141111" /> : null} initialNumToRender={20} maxToRenderPerBatch={15} windowSize={7} removeClippedSubviews={Platform.OS !== "ios"} maintainVisibleContentPosition={messageListGeneration === 0 ? { minIndexForVisible: 0 } : undefined} />
        {newMessageCount > 0 ? <View style={styles.newMessageBar}><Pressable style={styles.newMessageButton} accessibilityRole="button" accessibilityLabel={`回到底部，${newMessageCount} 条新消息`} onPress={scrollToLatest}><Text style={styles.newMessageText}>{newMessageCount} 条新消息 · 回到底部</Text></Pressable></View> : null}
        <View style={styles.composer}><View style={styles.composerTools}><Pressable style={styles.composerIconButton} accessibilityLabel="添加附件" disabled={uploading || sending} onPress={() => void chooseAttachments()}><MaterialCommunityIcons name="paperclip" size={16} color="#141111" /></Pressable>{pickedAttachments.length ? <Text numberOfLines={1} style={styles.attachmentPending}>已选 {pickedAttachments.map((asset) => asset.name).join("、")}</Text> : null}</View><TextInput value={draft} onChangeText={handleDraftChange} onSelectionChange={(event) => { const cursor = event.nativeEvent.selection.end; const currentDraft = active ? draftsRef.current[active.id] ?? draft : draft; updateMentionTrigger(currentDraft, cursor); }} placeholder="写消息…" multiline maxLength={32000} style={styles.composerInput} textAlignVertical="top" /><Pressable style={[styles.send, (!draft.trim() || sending || uploading) && styles.disabled]} disabled={!draft.trim() || sending || uploading} accessibilityLabel="发送消息" onPress={() => void submitMessage()}><MaterialCommunityIcons name="send" size={15} color="#141111" /></Pressable>{mentionTrigger && mentionResults.length ? <View style={styles.mentionMenu}>{mentionResults.map((candidate) => <Pressable key={`${candidate.type}:${candidate.id}`} style={styles.mentionRow} onPress={() => chooseMention(candidate)}><Text style={styles.mentionName}>@{candidate.name}</Text><Text style={styles.muted}>{candidate.type === "agent" ? "Agent" : "成员"}</Text></Pressable>)} </View> : null}</View>
      </KeyboardAvoidingView>}
    </> : null}
    {notice ? <Pressable style={styles.notice} onPress={() => setNotice("")}><Text numberOfLines={2} style={styles.noticeText}>{notice}</Text></Pressable> : null}
    <Modal visible={Boolean(previewAttachment)} transparent animationType="fade" onRequestClose={() => { setPreviewAttachment(null); setPreviewText(null); }}><View style={styles.previewBackdrop}><Pressable style={styles.previewClose} accessibilityLabel="关闭附件预览" onPress={() => { setPreviewAttachment(null); setPreviewText(null); }}><Text style={styles.previewCloseLabel}>关闭</Text></Pressable>{previewAttachment && previewAttachment.mimeType?.startsWith("image/") && attachmentUrls[previewAttachment.id] ? <Image testID="attachment-preview-image" accessibilityLabel={`附件预览 ${previewAttachment.filename}`} source={{ uri: attachmentUrls[previewAttachment.id] }} resizeMode="contain" style={styles.previewImage} /> : null}{previewText !== null ? <ScrollView style={styles.previewDocument} contentContainerStyle={styles.previewDocumentContent}><Text>{previewText}</Text></ScrollView> : null}<Text style={styles.previewCaption}>{previewAttachment?.filename}</Text></View></Modal>
  </>;
  return <SafeAreaView style={styles.safe}><StatusBar style="dark" />
    {isWide ? <View style={styles.wideShell}>
      <View style={styles.wideRail}><Pressable style={styles.wideRailBrand} onPress={() => setMode("conversations")} accessibilityLabel="Raft 主页"><Text style={styles.wideRailBrandText}>R</Text></Pressable><Pressable accessibilityLabel="搜索" style={styles.wideRailButton} onPress={() => setMode("stage2")}><MaterialCommunityIcons name="magnify" size={21} color="#141111" /></Pressable><Pressable accessibilityLabel="聊天" style={styles.wideRailButton} onPress={() => setMode("conversations")}><MaterialCommunityIcons name="message-text-outline" size={21} color="#141111" /></Pressable><Pressable accessibilityLabel="动态" style={styles.wideRailButton} onPress={() => setMode("stage2")}><MaterialCommunityIcons name="bell-outline" size={21} color="#141111" /></Pressable><Pressable accessibilityLabel="任务" style={styles.wideRailButton} onPress={() => openStage3("tasks")}><MaterialCommunityIcons name="format-list-checks" size={21} color="#141111" /></Pressable><Pressable accessibilityLabel="成员" style={styles.wideRailButton} onPress={() => openStage3("members")}><MaterialCommunityIcons name="account-multiple-outline" size={21} color="#141111" /></Pressable><View style={styles.wideRailSpacer} /><Pressable accessibilityLabel="设置" style={styles.wideRailButton} onPress={() => setMode("settings")}><MaterialCommunityIcons name="cog-outline" size={21} color="#141111" /></Pressable></View>
      <View style={styles.wideSidebar}><View style={styles.wideSidebarHeader}><Text style={styles.wideSidebarTitle}>Chat</Text><Text style={styles.wideSidebarServer}>{server?.name || "Raft"}</Text></View>{mode === "conversations" || mode === "chat" ? channelList : null}</View>
      <View style={styles.wideMain}>{mode === "chat" ? <View style={styles.wideChatHeader}><View style={styles.wideChatTitleBlock}><View style={styles.wideChannelIcon}><MaterialCommunityIcons name={active?.type === "dm" ? "at" : "pound"} size={18} color="#141111" /></View><View><Text style={styles.wideChatTitle}>{title}</Text><Text style={styles.wideChatMeta}>频道消息</Text></View></View><View style={styles.wideHeaderActions}><Pressable accessibilityLabel="搜索频道" style={styles.wideHeaderIcon}><MaterialCommunityIcons name="magnify" size={17} color="#141111" /></Pressable><Pressable accessibilityLabel="通知" style={styles.wideHeaderIcon}><MaterialCommunityIcons name="bell-outline" size={17} color="#141111" /></Pressable><Pressable accessibilityLabel="频道设置" style={styles.wideHeaderIcon}><MaterialCommunityIcons name="cog-outline" size={17} color="#141111" /></Pressable></View></View> : null}{mainContent}</View>
    </View> : <>{mode !== "conversations" ? <View style={styles.header}><Pressable style={styles.headerBack} onPress={back}><Text style={styles.headerAction}>{mode === "chat" ? threadParent ? "‹ 频道" : "‹ 消息" : mode === "stage2" || mode === "settings" ? "‹ 消息" : mode === "servers" ? "‹ 返回" : "工作区"}</Text></Pressable><Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>{mode === "chat" ? title : mode === "stage2" ? "搜索 · 动态 · 保存" : mode === "settings" ? "设置" : server?.name || "Raft"}</Text><View style={styles.headerRight}><Pressable disabled={!server || mode === "stage2" || mode === "settings"} onPress={() => setMode("stage2")} accessibilityRole="button" accessibilityLabel="搜索动态保存"><Text style={[styles.headerAction, (!server || mode === "stage2" || mode === "settings") && styles.headerActionDisabled]}>发现</Text></Pressable><Pressable disabled={mode === "settings"} onPress={() => setMode("settings")} accessibilityRole="button" accessibilityLabel="设置"><Text style={[styles.headerAction, mode === "settings" && styles.headerActionDisabled]}>设置</Text></Pressable><Pressable onPress={() => void logout()} accessibilityRole="button" accessibilityLabel="退出"><Text style={styles.headerAction}>退出</Text></Pressable></View></View> : null}{mainContent}</>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.white }, center: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 160 },
  authShell: { flex: 1, backgroundColor: "#FFFFFF" }, authFlex: { flex: 1 }, authTopBar: { height: 58, backgroundColor: "#FFD440", borderBottomWidth: 2, borderBottomColor: "#141111", paddingHorizontal: 20, justifyContent: "center" }, authLogo: { width: 118, height: 30 }, authContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 40 }, authForm: { width: "100%", maxWidth: 420, alignSelf: "center" }, authTitle: { color: "#141111", fontSize: 24, fontWeight: "700", textAlign: "center", marginBottom: 20 }, authDescription: { color: "#141111", opacity: 0.6, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: -8, marginBottom: 20 }, authStrong: { fontWeight: "700", fontFamily: Platform.OS === "ios" ? "Menlo" : undefined }, authBanner: { backgroundColor: "#FFF0E8", borderWidth: 2, borderColor: "#141111", padding: 10, marginBottom: 16 }, authBannerText: { color: "#141111", fontSize: 13, fontWeight: "700" }, authField: { marginBottom: 16 }, authLabel: { color: "#141111", fontSize: 14, fontWeight: "700", marginBottom: 5 }, authInput: { minHeight: 44, borderWidth: 2, borderColor: "#141111", paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, color: "#141111", backgroundColor: "#FFFFFF", shadowColor: "#141111", shadowOffset: { width: 2, height: 2 }, shadowOpacity: 1, shadowRadius: 0, elevation: 2 }, authPrimary: { minHeight: 48, backgroundColor: "#FE7DA8", borderWidth: 2, borderColor: "#141111", alignItems: "center", justifyContent: "center", shadowColor: "#141111", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4, marginTop: 2, marginBottom: 18 }, authPrimaryText: { color: "#141111", fontSize: 15, fontWeight: "700" }, authDisabled: { opacity: 0.45 }, authLink: { color: "#141111", fontSize: 14, fontWeight: "700", textAlign: "center", textDecorationLine: "underline", marginBottom: 14 }, authPrompt: { color: "#141111", fontSize: 14, textAlign: "center", marginBottom: 12 }, authLinkInline: { color: "#FE7DA8", fontWeight: "700", textDecorationLine: "underline" }, legalAgreement: { color: "#141111", opacity: 0.6, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 },
  legalRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 }, checkbox: { width: 22, height: 22, borderWidth: 2, borderColor: "#141111", marginRight: 8, alignItems: "center", justifyContent: "center" }, checkboxChecked: { backgroundColor: "#FFD440" }, checkmark: { color: "#141111", fontWeight: "800" }, legalText: { flex: 1, color: "#141111", fontSize: 13 }, error: { color: "#B91C1C", fontSize: 13 }, errorBar: { backgroundColor: "#FEF2F2", padding: 8 },
  header: { height: 54, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: "#141111", flexDirection: "row", alignItems: "center", backgroundColor: "#FFFDF5" }, headerBack: { flexShrink: 0 }, headerRight: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4 }, headerAction: { color: "#141111", fontSize: 14, paddingHorizontal: 4, fontWeight: "700" }, headerActionDisabled: { opacity: 0.45 }, headerTitle: { flex: 1, minWidth: 0, marginHorizontal: 8, color: "#141111", fontSize: 17, fontWeight: "800", textAlign: "center" }, listPad: { paddingBottom: 20 }, conversationRow: { minHeight: 68, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: "#141111", paddingHorizontal: 18 }, rowTitle: { color: "#141111", fontSize: 16, fontWeight: "700" }, muted: { color: "#718096", fontSize: 12, marginTop: 3 }, chat: { flex: 1, backgroundColor: "#FFFFFF" }, chatTabs: { minHeight: 43, flexDirection: "row", alignItems: "stretch", borderBottomWidth: 2, borderBottomColor: "#141111", backgroundColor: "#FFFFFF" }, chatTab: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 16, borderRightWidth: 1, borderRightColor: "#141111" }, chatTabSelected: { backgroundColor: "#FFD440" }, chatTabLabel: { color: "#718096", fontSize: 12, fontWeight: "700" }, chatTabLabelSelected: { color: "#141111" }, action: { color: "#141111", fontSize: 13, fontWeight: "700", textDecorationLine: "underline" }, channelPanel: { flex: 1, backgroundColor: "#FFFDF5", padding: 14 }, channelPanelHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: "#141111" }, channelPanelTitle: { color: "#141111", fontSize: 18, fontWeight: "800" }, channelPanelHint: { color: "#718096", fontSize: 13, marginTop: 5 }, channelPanelList: { gap: 8, paddingVertical: 12 }, channelTaskRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: 12, borderWidth: 2, borderColor: "#141111", backgroundColor: "#FFFFFF" }, channelTaskCopy: { flex: 1, minWidth: 0 }, channelTaskNumber: { color: "#718096", fontSize: 11, fontWeight: "700" }, channelTaskTitle: { color: "#141111", fontSize: 15, fontWeight: "800", marginTop: 3 }, channelTaskAssignee: { color: "#141111", fontSize: 12, fontWeight: "700" }, channelTaskActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 }, channelFileRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderWidth: 2, borderColor: "#141111", backgroundColor: "#FFFFFF" }, channelFileIcon: { width: 30, height: 30, alignItems: "center", justifyContent: "center", backgroundColor: "#FFD440", borderWidth: 2, borderColor: "#141111" }, channelFileCopy: { flex: 1, minWidth: 0 }, channelFileName: { color: "#141111", fontSize: 14, fontWeight: "800" }, channelFileActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 7 }, threadParent: { padding: 10, backgroundColor: "#FFFDF5", borderBottomWidth: 2, borderBottomColor: "#141111" }, focusedMessageCard: { marginHorizontal: 14, marginTop: 10, padding: 12, backgroundColor: "#FFF5B8", borderWidth: 2, borderColor: "#141111", shadowColor: "#141111", shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 }, focusedMessageLabel: { color: "#141111", fontSize: 12, fontWeight: "800", marginBottom: 4 }, messages: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 }, latestWindow: { flex: 1, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 }, messageRow: { flexDirection: "row", gap: 10, paddingVertical: 8, paddingHorizontal: 8, marginBottom: 1, borderWidth: 2, borderColor: "transparent", backgroundColor: "#FFFFFF" }, highlightedMessageRow: { borderColor: "#141111", backgroundColor: "#FFF5B8", shadowColor: "#141111", shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0 }, messageAvatar: { width: 36, height: 36, marginTop: 1, borderWidth: 2, borderColor: "#141111", backgroundColor: "#FFD440", alignItems: "center", justifyContent: "center" }, messageAvatarText: { color: "#141111", fontSize: 15, fontWeight: "900" }, messageBody: { flex: 1, minWidth: 0 }, messageHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }, sender: { color: "#141111", fontSize: 13, fontWeight: "800" }, time: { color: "#718096", fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : undefined }, content: { color: "#141111", fontSize: 15, lineHeight: 22 }, attachmentRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, padding: 9, backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: "#141111" }, attachmentCopy: { flex: 1, minWidth: 0 }, attachmentLabel: { color: "#141111", fontSize: 13, fontWeight: "700" }, mentionSummary: { color: "#141111", fontSize: 12, marginTop: 7, fontWeight: "700" }, newMessageBar: { paddingHorizontal: 12, paddingBottom: 8, alignItems: "center" }, newMessageButton: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 2, borderColor: "#141111", backgroundColor: "#FFD440", shadowColor: "#141111", shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 }, newMessageText: { color: "#141111", fontSize: 13, fontWeight: "800" }, composer: { position: "relative", borderTopWidth: 2, borderTopColor: "#141111", padding: 10, backgroundColor: "#FFFFFF" }, composerTools: { flexDirection: "row", alignItems: "center", marginBottom: 6, minHeight: 28 }, composerIconButton: { width: 30, height: 28, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#141111", backgroundColor: "#FFFFFF" }, toolButton: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: "#141111" }, toolLabel: { color: "#141111", fontSize: 13, fontWeight: "700" }, attachmentPending: { flex: 1, color: "#718096", fontSize: 12, marginLeft: 8 }, composerInput: { maxHeight: 140, minHeight: 44, padding: 10, paddingRight: 52, borderWidth: 2, borderColor: "#141111", fontSize: 15, color: "#141111", backgroundColor: "#FFFFFF" }, send: { position: "absolute", right: 10, bottom: 10, width: 38, height: 38, alignItems: "center", justifyContent: "center", backgroundColor: "#FE7DA8", borderWidth: 2, borderColor: "#141111", shadowColor: "#141111", shadowOffset: { width: 2, height: 2 }, shadowOpacity: 1, shadowRadius: 0, elevation: 2 }, sendLabel: { color: "#141111", fontWeight: "800" }, mentionMenu: { position: "absolute", left: 10, right: 10, bottom: 64, maxHeight: 220, backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: "#141111", shadowColor: "#141111", shadowOffset: { width: 3, height: -3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 }, mentionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#141111" }, mentionName: { color: "#141111", fontSize: 14, fontWeight: "700" }, previewBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.92)", padding: 20 }, previewClose: { position: "absolute", top: 56, right: 20, padding: 10 }, previewCloseLabel: { color: color.white, fontWeight: "700" }, previewImage: { width: "100%", height: "75%" }, previewDocument: { width: "100%", maxHeight: "70%", backgroundColor: color.white, padding: 14 }, previewDocumentContent: { paddingBottom: 12 }, previewCaption: { color: color.white, marginTop: 12 }, notice: { position: "absolute", bottom: 92, left: 12, right: 12, padding: 12, borderWidth: 2, borderColor: "#141111", backgroundColor: "#141111" }, noticeText: { color: color.white },
  disabled: { opacity: 0.35 }, mobileHome: { flex: 1, backgroundColor: "#FFFDF5" }, mobileWorkspaceHeader: { minHeight: 62, paddingHorizontal: 18, backgroundColor: "#FFD440", borderBottomWidth: 2, borderBottomColor: "#141111", flexDirection: "row", alignItems: "center" }, mobileWorkspaceName: { flex: 1, color: "#141111", fontSize: 18, fontWeight: "800" }, mobileWorkspaceChevron: { color: "#141111", fontSize: 20, marginRight: 14 }, mobileBell: { color: "#141111", fontSize: 22 }, mobileHomeLinks: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#141111" }, mobileHomeLink: { minHeight: 44, paddingHorizontal: 18, flexDirection: "row", alignItems: "center" }, mobileHomeIcon: { width: 28, color: "#141111", fontSize: 20, textAlign: "center" }, mobileHomeLinkText: { color: "#141111", fontSize: 15, fontWeight: "600", marginLeft: 8 }, mobileChannelScroll: { flex: 1 }, mobileChannelContent: { paddingBottom: 12 }, mobileSectionHeader: { minHeight: 42, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, mobileSectionTitle: { color: "#141111", fontSize: 12, fontWeight: "800", letterSpacing: 1 }, mobileSectionCount: { color: "#718096", fontWeight: "600" }, mobileSectionAction: { color: "#141111", fontSize: 18 }, mobileEmptyHint: { paddingHorizontal: 18, paddingBottom: 12, color: "#718096", fontSize: 12 }, mobileChannelRow: { minHeight: 42, paddingHorizontal: 20, justifyContent: "center" }, mobileChannelName: { color: "#141111", fontSize: 15, fontWeight: "600" }, mobileBottomTabs: { minHeight: 58, borderTopWidth: 2, borderTopColor: "#141111", backgroundColor: "#FFD440", flexDirection: "row" }, mobileBottomTab: { flex: 1, alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderRightColor: "#141111" }, mobileBottomIcon: { color: "#141111", fontSize: 18 }, mobileBottomText: { color: "#141111", fontSize: 11, fontWeight: "700", marginTop: 2 }, selectChannel: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFDF5" }, selectChannelText: { color: "#718096", fontSize: 16, fontWeight: "700", textTransform: "uppercase" },
  wideShell: { flex: 1, flexDirection: "row", backgroundColor: "#FFFDF5" }, wideRail: { width: 58, backgroundColor: "#FFD440", borderRightWidth: 2, borderRightColor: "#141111", alignItems: "center", paddingVertical: 8 }, wideRailBrand: { width: 42, height: 42, backgroundColor: "#141111", alignItems: "center", justifyContent: "center", marginBottom: 14 }, wideRailBrandText: { color: "#FFD440", fontSize: 20, fontWeight: "900" }, wideRailButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" }, wideRailGlyph: { color: "#141111", fontSize: 22 }, wideRailSpacer: { flex: 1 }, wideSidebar: { width: 244, backgroundColor: "#FFFDF5", borderRightWidth: 2, borderRightColor: "#141111" }, wideSidebarHeader: { minHeight: 62, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: "#141111", justifyContent: "center" }, wideSidebarTitle: { color: "#141111", fontSize: 19, fontWeight: "800" }, wideSidebarServer: { color: "#718096", fontSize: 11, marginTop: 3 }, wideMain: { flex: 1, minWidth: 0 }, wideChatHeader: { minHeight: 62, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: "#141111", backgroundColor: "#FFFDF5", flexDirection: "row", alignItems: "center" }, wideChatTitleBlock: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 }, wideChannelIcon: { width: 28, height: 28, borderWidth: 2, borderColor: "#141111", alignItems: "center", justifyContent: "center", backgroundColor: "#FFD440" }, wideChatTitle: { color: "#141111", fontSize: 18, fontWeight: "800" }, wideChatMeta: { color: "#718096", fontSize: 12, marginTop: 1 }, wideHeaderActions: { flexDirection: "row", gap: 4 }, wideHeaderIcon: { width: 30, height: 30, alignItems: "center", justifyContent: "center" }

});
