import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { StatusBar } from "expo-status-bar";
import { api, apiMultipart, forgotPassword, getChannel, getChannelMembers, getChannels, getDMs, getMessageContext, getMessages, getOrCreateThread, getServers, login, logoutRemote, register, sendMessage } from "./src/api";
import { bumpSessionGeneration, clearSession, getSessionGeneration, readSession } from "./src/session";
import { registerForPush, subscribeToNotificationTap, unregisterForPush } from "./src/push";
import { createRaftSocket } from "./src/socket";
import { MessageCache } from "./src/messageCache";
import { completedCursor, isCurrentScope, sendableDraft } from "./src/behavior";
import { canClearComposerAfterSend, type ComposerSnapshot } from "./src/asyncGuards";
import type { Channel, Message, Server } from "./src/types";
import { resolveAttachmentUrls, uploadAttachments, type Attachment, type PickedAttachment, pickAttachments } from "./src/attachments";
import { buildMentionCandidateGroups, buildStructuredMentions, findMentionTrigger, insertMentionAtCursor, type MentionCandidate, type MentionTrigger, type StructuredMention } from "./src/mentions";
import { Stage2Navigator } from "./src/screens/Stage2Navigator";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import type { ActivityInboxRow, SavedMessage, SearchResult } from "./src/stage2Api";

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
  createdAt: m.createdAt || new Date().toISOString(),
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

export default function App() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [server, setServer] = useState<Server | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<Channel | null>(null);
  const [mode, setMode] = useState<ViewMode>("conversations");
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadOrigin, setThreadOrigin] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
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
  const loadingOlder = useRef(false);
  const navigationRef = useRef<{ serverId: string; channelId: string; messageId?: string } | null>(null);
  const focusMessageRef = useRef<string | null>(null);
  const sessionEpochRef = useRef(getSessionGeneration());
  const composerOperationRef = useRef(0);
  const draftsRef = useRef<Record<string, string>>({});
  const composerSnapshotRef = useRef<{ channelId: string | null; draft: string; attachmentIds: readonly string[]; mentionKeys: readonly string[] }>({ channelId: null, draft: "", attachmentIds: [], mentionKeys: [] });
  const [notice, setNotice] = useState("");

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
  const open = (item: Channel, parent: Message | null = null, focusMessageId?: string) => { composerOperationRef.current += 1; focusMessageRef.current = focusMessageId ?? null; setHighlightedMessageId(null); setActive(item); activeRef.current = item; setThreadParent(parent); if (!parent) setThreadOrigin(null); setMode("chat"); setError(null); setUploading(false); setSending(false); clearComposerAttachments(); clearAttachmentUrls(); setSelectedMentions([]); setMentionTrigger(null); setMentionQuery(""); setCursorPosition(0); };
  const back = () => {
    if (mode === "chat" && threadParent && threadOrigin) { open(threadOrigin); return; }
    if (mode === "chat") { composerOperationRef.current += 1; setMode("conversations"); setActive(null); activeRef.current = null; setThreadParent(null); setUploading(false); setSending(false); clearComposerAttachments(); clearAttachmentUrls(); setSelectedMentions([]); setMentionTrigger(null); setMentionQuery(""); return; }
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
  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  useEffect(() => { void readSession().then(({ accessToken }) => { sessionEpochRef.current = getSessionGeneration(); setLoggedIn(Boolean(accessToken)); setReady(true); }).catch((cause) => { report(cause); setReady(true); }); }, []);
  useEffect(() => {
    if (!loggedIn) return;
    const epoch = sessionEpochRef.current;
    void getServers().then((rows) => {
      if (sessionEpochRef.current !== epoch) return;
      serversRef.current = rows;
      setServers(rows);
      setServer((current) => rows.find((row) => row.id === navigationRef.current?.serverId) ?? (current && rows.some((row) => row.id === current.id) ? current : rows[0] ?? null));
    }).catch((e) => { if (sessionEpochRef.current === epoch) report(e); });
  }, [loggedIn]);
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
      const next = messageCacheRef.current.get(server.id, row.channelId);
      if (isCurrentScope({ serverId: server.id, channelId: row.channelId }, serverRef.current && activeRef.current ? { serverId: serverRef.current.id, channelId: activeRef.current.id } : null)) setMessages(next);
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
          setMessages([]);
          setHighlightedMessageId(null);
          setHasOlder(false);
          setLoading(false);
          setError("消息不存在或无权访问");
          return;
        }
        messageCacheRef.current.merge(serverId, focusedRows);
        setMessages(focusedRows);
      } else {
        messageCacheRef.current.merge(serverId, rows);
        setMessages(messageCacheRef.current.get(serverId, channelId));
      }
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
      const next = messageCacheRef.current.get(serverId, channelId);
      if (scopeIsCurrent(serverId, channelId, epoch)) {
        setMessages(next);
        setHasOlder(rows.length >= 50 && !result.historyLimited);
      }
    } catch (e) { if (epoch === sessionEpochRef.current) report(e); } finally { loadingOlder.current = false; }
  };
  const switchAuth = (next: AuthMode) => { setAuthMode(next); setError(null); setForgotSent(false); };
  const submitLogin = async () => {
    setError(null); setAuthBusy(true);
    try {
      if (!validEmail(email.trim())) throw new Error("请输入有效邮箱地址。");
      if (authMode === "login" && !password) throw new Error("请输入密码。");
      if (authMode === "register" && password.length < 8) throw new Error("密码至少需要 8 个字符。");
      if (authMode === "login") { await login(email.trim(), password); sessionEpochRef.current = getSessionGeneration(); setLoggedIn(true); }
      else if (authMode === "register") {
        if (!acceptedLegal) throw new Error("创建账号前需要同意服务条款并确认隐私政策。");
        await register(email.trim(), password); sessionEpochRef.current = getSessionGeneration(); setLoggedIn(true);
      } else { await forgotPassword(email.trim()); setForgotSent(true); }
    } catch (e) { report(e); }
    finally { setAuthBusy(false); }
  };
  const logout = async () => {
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
    setMessages([]);
    setHighlightedMessageId(null);
    pendingServerSeqRef.current.clear();
    checkedServerSeqRef.current.clear();
    messageCacheRef.current.clear();
    serverCursorRef.current.clear();
    setLoggedIn(false);
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
        setMessages(next);
        list.current?.scrollToOffset({ offset: 0, animated: true });
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
              <View style={styles.authField}><Text style={styles.authLabel}>邮箱</Text><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" textContentType="username" autoComplete="email" style={styles.authInput} /></View>
              {authMode !== "forgot" ? <View style={styles.authField}><Text style={styles.authLabel}>密码</Text><TextInput value={password} onChangeText={setPassword} placeholder={authMode === "register" ? "至少 8 个字符" : undefined} secureTextEntry textContentType={authMode === "register" ? "newPassword" : "password"} autoComplete={authMode === "register" ? "password-new" : "password"} style={styles.authInput} /></View> : null}
              {authMode === "register" ? <Pressable style={styles.legalRow} onPress={() => setAcceptedLegal((value) => !value)}><View style={[styles.checkbox, acceptedLegal && styles.checkboxChecked]}>{acceptedLegal ? <Text style={styles.checkmark}>✓</Text> : null}</View><Text style={styles.legalText}>我同意 <Text style={styles.authLinkInline} onPress={() => void Linking.openURL("https://raft.build/terms")}>服务条款</Text> 并确认 <Text style={styles.authLinkInline} onPress={() => void Linking.openURL("https://raft.build/privacy")}>隐私政策</Text>。</Text></Pressable> : null}
              <Pressable style={[styles.authPrimary, (authBusy || (authMode === "register" && !acceptedLegal)) && styles.authDisabled]} disabled={authBusy || (authMode === "register" && !acceptedLegal)} onPress={() => void submitLogin()}><Text style={styles.authPrimaryText}>{authBusy ? authMode === "forgot" ? "发送中…" : authMode === "register" ? "创建账号中…" : "登录中…" : authMode === "forgot" ? "发送重置链接" : authMode === "register" ? "继续" : "登录"}</Text></Pressable>
            </> : null}
            {authMode === "login" ? <><Text style={styles.legalAgreement}>继续即表示你同意 <Text style={styles.authLinkInline} onPress={() => void Linking.openURL("https://raft.build/terms")}>服务条款</Text> 和 <Text style={styles.authLinkInline} onPress={() => void Linking.openURL("https://raft.build/privacy")}>隐私政策</Text>。</Text><Pressable onPress={() => switchAuth("forgot")}><Text style={styles.authLink}>忘记密码？</Text></Pressable><Text style={styles.authPrompt}>还没有账号？<Text style={styles.authLinkInline} onPress={() => switchAuth("register")}>创建一个</Text></Text></> : null}
            {authMode === "register" ? <Text style={styles.authPrompt}>已有账号？<Text style={styles.authLinkInline} onPress={() => switchAuth("login")}>登录</Text></Text> : null}
            {authMode === "forgot" ? <Pressable onPress={() => switchAuth("login")}><Text style={styles.authLink}>返回登录</Text></Pressable> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>;
  }
  return <SafeAreaView style={styles.safe}><StatusBar style="dark" />
    <View style={styles.header}><Pressable onPress={back}><Text style={styles.headerAction}>{mode === "chat" ? threadParent ? "‹ 频道" : "‹ 消息" : mode === "stage2" || mode === "settings" ? "‹ 消息" : mode === "servers" ? "‹ 返回" : "工作区"}</Text></Pressable><Text numberOfLines={1} style={styles.headerTitle}>{mode === "chat" ? title : mode === "stage2" ? "搜索 · 动态 · 保存" : mode === "settings" ? "设置" : server?.name || "Raft"}</Text><View style={styles.headerRight}><Pressable disabled={!server || mode === "stage2" || mode === "settings"} onPress={() => setMode("stage2")} accessibilityRole="button" accessibilityLabel="搜索动态保存"><Text style={[styles.headerAction, (!server || mode === "stage2" || mode === "settings") && styles.headerActionDisabled]}>发现</Text></Pressable><Pressable disabled={mode === "settings"} onPress={() => setMode("settings")} accessibilityRole="button" accessibilityLabel="设置"><Text style={[styles.headerAction, mode === "settings" && styles.headerActionDisabled]}>设置</Text></Pressable><Pressable onPress={() => void logout()} accessibilityRole="button" accessibilityLabel="退出"><Text style={styles.headerAction}>退出</Text></Pressable></View></View>
    {error ? <Pressable onPress={() => setError(null)} style={styles.errorBar}><Text numberOfLines={2} style={styles.error}>{error}</Text></Pressable> : null}
    {mode === "servers" ? <FlatList data={servers} keyExtractor={(item) => item.id} contentContainerStyle={styles.listPad} renderItem={({ item }) => <Pressable style={styles.conversationRow} onPress={() => { setServer(item); setMode("conversations"); }}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.muted}>{item.slug}</Text></Pressable>} /> : null}
    {mode === "conversations" ? <FlatList data={channels} keyExtractor={(item) => item.id} contentContainerStyle={styles.listPad} renderItem={({ item }) => <Pressable style={styles.conversationRow} onPress={() => open(item)}><Text style={styles.rowTitle}>{item.type === "dm" ? "@" : "#"} {displayName(item)}</Text><Text style={styles.muted}>{item.type === "dm" ? "私信" : "频道"}</Text></Pressable>} ListEmptyComponent={<View style={styles.center}><Text style={styles.muted}>暂无已加入的频道或私信</Text></View>} /> : null}
    {mode === "stage2" && server ? <Stage2Navigator serverId={server.id} onOpenSearchResult={openStage2SearchResult} onOpenActivityRow={openStage2ActivityRow} onOpenSavedMessage={openStage2SavedMessage} /> : null}
    {mode === "settings" ? <SettingsScreen serverId={server?.id ?? null} onBack={back} onLogout={() => void logout()} /> : null}
    {mode === "chat" ? <KeyboardAvoidingView style={styles.chat} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>{threadParent ? <View style={styles.threadParent}><Text style={styles.muted}>回复 {threadParent.senderName}</Text><Text numberOfLines={2}>{threadParent.content}</Text></View> : null}{focusedMessage ? <View style={styles.focusedMessageCard} accessibilityLabel={`已定位消息 ${focusedMessage.content}`}><Text style={styles.focusedMessageLabel}>已定位消息</Text><Text style={styles.sender}>{focusedMessage.senderName}</Text><Text style={styles.content}>{focusedMessage.content}</Text></View> : null}<FlatList ref={list} inverted data={messages} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.messages} renderItem={({ item }) => <Pressable accessible={false} style={[styles.message, highlightedMessageId === item.id && styles.highlightedMessage]} onPress={() => void openThread(item)}><View style={styles.messageHeader}><Text style={styles.sender}>{item.senderName}</Text><Text style={styles.time}>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text></View><Text style={styles.content}>{item.content}</Text>{item.attachments?.map((attachment) => <Pressable key={attachment.id} style={styles.attachmentRow} accessibilityLabel={`打开附件 ${attachment.filename} · 消息 ${item.content}`} onPress={() => void openAttachment(attachment)}><Text style={styles.attachmentLabel}>📎 {attachment.filename}</Text><Text style={styles.muted}>{attachment.mimeType || "附件"} · 点按打开</Text></Pressable>)}{item.mentions?.length ? <Text style={styles.mentionSummary}>提及：{item.mentions.map((mention) => `@${mention.name}`).join(" ")}</Text> : null}</Pressable>} onEndReached={() => void loadOlder()} onEndReachedThreshold={0.3} ListFooterComponent={loading ? <ActivityIndicator color={color.blue} /> : null} initialNumToRender={20} maxToRenderPerBatch={15} windowSize={7} removeClippedSubviews={Platform.OS !== "ios"} maintainVisibleContentPosition={{ minIndexForVisible: 0 }} /><View style={styles.composer}><View style={styles.composerTools}><Pressable style={styles.toolButton} accessibilityLabel="添加附件" disabled={uploading || sending} onPress={() => void chooseAttachments()}><Text style={styles.toolLabel}>{uploading ? "上传中…" : "附件"}</Text></Pressable>{pickedAttachments.length ? <Text numberOfLines={1} style={styles.attachmentPending}>已选 {pickedAttachments.map((asset) => asset.name).join("、")}</Text> : null}</View><TextInput value={draft} onChangeText={handleDraftChange} onSelectionChange={(event) => { const cursor = event.nativeEvent.selection.end; const currentDraft = active ? draftsRef.current[active.id] ?? draft : draft; updateMentionTrigger(currentDraft, cursor); }} placeholder="写消息…" multiline maxLength={32000} style={styles.composerInput} textAlignVertical="top" /><Pressable style={[styles.send, (!draft.trim() || sending || uploading) && styles.disabled]} disabled={!draft.trim() || sending || uploading} accessibilityLabel="发送消息" onPress={() => void submitMessage()}><Text style={styles.sendLabel}>发送</Text></Pressable>{mentionTrigger && mentionResults.length ? <View style={styles.mentionMenu}>{mentionResults.map((candidate) => <Pressable key={`${candidate.type}:${candidate.id}`} style={styles.mentionRow} onPress={() => chooseMention(candidate)}><Text style={styles.mentionName}>@{candidate.name}</Text><Text style={styles.muted}>{candidate.type === "agent" ? "Agent" : "成员"}</Text></Pressable>)} </View> : null}</View></KeyboardAvoidingView> : null}
    {notice ? <Pressable style={styles.notice} onPress={() => setNotice("")}><Text numberOfLines={2} style={styles.noticeText}>{notice}</Text></Pressable> : null}
    <Modal visible={Boolean(previewAttachment)} transparent animationType="fade" onRequestClose={() => { setPreviewAttachment(null); setPreviewText(null); }}><View style={styles.previewBackdrop}><Pressable style={styles.previewClose} accessibilityLabel="关闭附件预览" onPress={() => { setPreviewAttachment(null); setPreviewText(null); }}><Text style={styles.previewCloseLabel}>关闭</Text></Pressable>{previewAttachment && previewAttachment.mimeType?.startsWith("image/") && attachmentUrls[previewAttachment.id] ? <Image testID="attachment-preview-image" accessibilityLabel={`附件预览 ${previewAttachment.filename}`} source={{ uri: attachmentUrls[previewAttachment.id] }} resizeMode="contain" style={styles.previewImage} /> : null}{previewText !== null ? <ScrollView style={styles.previewDocument} contentContainerStyle={styles.previewDocumentContent}><Text>{previewText}</Text></ScrollView> : null}<Text style={styles.previewCaption}>{previewAttachment?.filename}</Text></View></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.white }, center: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 160 },
  authShell: { flex: 1, backgroundColor: "#FFFFFF" }, authFlex: { flex: 1 }, authTopBar: { height: 58, backgroundColor: "#FFD440", borderBottomWidth: 2, borderBottomColor: "#141111", paddingHorizontal: 20, justifyContent: "center" }, authLogo: { width: 118, height: 30 }, authContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 40 }, authForm: { width: "100%", maxWidth: 420, alignSelf: "center" }, authTitle: { color: "#141111", fontSize: 24, fontWeight: "700", textAlign: "center", marginBottom: 20 }, authDescription: { color: "#141111", opacity: 0.6, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: -8, marginBottom: 20 }, authStrong: { fontWeight: "700", fontFamily: Platform.OS === "ios" ? "Menlo" : undefined }, authBanner: { backgroundColor: "#FFF0E8", borderWidth: 2, borderColor: "#141111", padding: 10, marginBottom: 16 }, authBannerText: { color: "#141111", fontSize: 13, fontWeight: "700" }, authField: { marginBottom: 16 }, authLabel: { color: "#141111", fontSize: 14, fontWeight: "700", marginBottom: 5 }, authInput: { minHeight: 44, borderWidth: 2, borderColor: "#141111", paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, color: "#141111", backgroundColor: "#FFFFFF", shadowColor: "#141111", shadowOffset: { width: 2, height: 2 }, shadowOpacity: 1, shadowRadius: 0, elevation: 2 }, authPrimary: { minHeight: 48, backgroundColor: "#FE7DA8", borderWidth: 2, borderColor: "#141111", alignItems: "center", justifyContent: "center", shadowColor: "#141111", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4, marginTop: 2, marginBottom: 18 }, authPrimaryText: { color: "#141111", fontSize: 15, fontWeight: "700" }, authDisabled: { opacity: 0.45 }, authLink: { color: "#141111", fontSize: 14, fontWeight: "700", textAlign: "center", textDecorationLine: "underline", marginBottom: 14 }, authPrompt: { color: "#141111", fontSize: 14, textAlign: "center", marginBottom: 12 }, authLinkInline: { color: "#FE7DA8", fontWeight: "700", textDecorationLine: "underline" }, legalAgreement: { color: "#141111", opacity: 0.6, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 },
  legalRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 }, checkbox: { width: 22, height: 22, borderWidth: 2, borderColor: "#141111", marginRight: 8, alignItems: "center", justifyContent: "center" }, checkboxChecked: { backgroundColor: "#FFD440" }, checkmark: { color: "#141111", fontWeight: "800" }, legalText: { flex: 1, color: "#141111", fontSize: 13 }, error: { color: "#B91C1C", fontSize: 13 }, errorBar: { backgroundColor: "#FEF2F2", padding: 8 },
  header: { height: 54, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: color.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, headerRight: { flexDirection: "row", alignItems: "center", gap: 8 }, headerAction: { color: color.blue, fontSize: 14, minWidth: 54 }, headerActionDisabled: { opacity: 0.45 }, headerTitle: { color: color.ink, fontSize: 17, fontWeight: "700", maxWidth: "52%" }, listPad: { paddingBottom: 20 }, conversationRow: { minHeight: 68, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: color.line, paddingHorizontal: 18 }, rowTitle: { color: color.ink, fontSize: 16, fontWeight: "600" }, muted: { color: color.muted, fontSize: 12, marginTop: 3 }, chat: { flex: 1 }, threadParent: { padding: 10, backgroundColor: color.bg, borderBottomWidth: 1, borderBottomColor: color.line }, focusedMessageCard: { marginHorizontal: 14, marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: color.mine, borderWidth: 2, borderColor: color.blue }, focusedMessageLabel: { color: color.blue, fontSize: 12, fontWeight: "700", marginBottom: 4 }, messages: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 }, message: { padding: 10, marginBottom: 8, borderRadius: 12, backgroundColor: color.bg }, highlightedMessage: { borderWidth: 2, borderColor: color.blue, backgroundColor: color.mine }, messageHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }, sender: { color: color.ink, fontSize: 13, fontWeight: "700" }, time: { color: color.muted, fontSize: 11 }, content: { color: color.ink, fontSize: 16, lineHeight: 23 }, attachmentRow: { marginTop: 7, padding: 8, borderRadius: 8, backgroundColor: color.white, borderWidth: 1, borderColor: color.line }, attachmentLabel: { color: color.ink, fontSize: 13, fontWeight: "600" }, mentionSummary: { color: color.blue, fontSize: 12, marginTop: 7 }, composer: { position: "relative", borderTopWidth: 1, borderTopColor: color.line, padding: 10, backgroundColor: color.white }, composerTools: { flexDirection: "row", alignItems: "center", marginBottom: 6, minHeight: 28 }, toolButton: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: color.bg }, toolLabel: { color: color.blue, fontSize: 13, fontWeight: "700" }, attachmentPending: { flex: 1, color: color.muted, fontSize: 12, marginLeft: 8 }, composerInput: { maxHeight: 140, minHeight: 44, padding: 10, paddingRight: 78, borderRadius: 12, borderWidth: 1, borderColor: color.line, fontSize: 16, color: color.ink }, send: { position: "absolute", right: 10, bottom: 10, minHeight: 44, justifyContent: "center", paddingHorizontal: 14, backgroundColor: color.blue, borderRadius: 12 }, disabled: { opacity: 0.4 }, sendLabel: { color: color.white, fontWeight: "700" }, mentionMenu: { position: "absolute", left: 10, right: 10, bottom: 64, maxHeight: 220, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, borderRadius: 10, shadowColor: color.ink, shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3 }, mentionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.line }, mentionName: { color: color.ink, fontSize: 14, fontWeight: "600" }, previewBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.92)", padding: 20 }, previewClose: { position: "absolute", top: 56, right: 20, padding: 10 }, previewCloseLabel: { color: color.white, fontWeight: "700" }, previewImage: { width: "100%", height: "75%" }, previewDocument: { width: "100%", maxHeight: "70%", backgroundColor: color.white, padding: 14 }, previewDocumentContent: { paddingBottom: 12 }, previewCaption: { color: color.white, marginTop: 12 }, notice: { position: "absolute", bottom: 92, left: 12, right: 12, padding: 12, borderRadius: 10, backgroundColor: color.ink }, noticeText: { color: color.white }
});
