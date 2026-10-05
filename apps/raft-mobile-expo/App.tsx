import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { getChannel, getChannels, getDMs, getMessages, getOrCreateThread, getServers, login, logoutRemote, sendMessage } from "./src/api";
import { clearSession, readSession } from "./src/session";
import { registerForPush, subscribeToNotificationTap, unregisterForPush } from "./src/push";
import { createRaftSocket } from "./src/socket";
import { MessageCache } from "./src/messageCache";
import type { Channel, Message, Server } from "./src/types";

const color = { ink: "#17212F", muted: "#718096", line: "#E5EAF0", bg: "#F6F8FB", blue: "#365FE8", mine: "#E8EEFF", white: "#FFFFFF" };
const displayName = (channel: Channel) => channel.type === "dm" ? channel.peerDisplayName || channel.peerName || channel.name || "私信" : channel.name || "未命名频道";
const normalize = (m: any): Message => ({ id: m.id, seq: m.seq, channelId: m.channelId, senderType: m.senderType, senderId: m.senderId, senderName: m.senderName || "Raft", content: m.content || "", createdAt: m.createdAt || new Date().toISOString(), messageType: m.messageType });

type ViewMode = "servers" | "conversations" | "chat";

export default function App() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [server, setServer] = useState<Server | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<Channel | null>(null);
  const [mode, setMode] = useState<ViewMode>("conversations");
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadOrigin, setThreadOrigin] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const list = useRef<FlatList<Message>>(null);
  const activeRef = useRef<Channel | null>(null);
  const serverRef = useRef<Server | null>(null);
  const serversRef = useRef<Server[]>([]);
  const channelsRef = useRef<Channel[]>([]);
  const messageCacheRef = useRef(new MessageCache());
  const serverCursorRef = useRef(new Map<string, number>());
  const syncingServerRef = useRef(new Set<string>());
  const checkedServerSeqRef = useRef(new Map<string, number>());
  const syncServerRef = useRef<(() => void) | null>(null);
  const socketRef = useRef<ReturnType<typeof createRaftSocket> | null>(null);
  const activeRequestRef = useRef(0);
  const loadingOlder = useRef(false);
  const navigationRef = useRef<{ serverId: string; channelId: string } | null>(null);
  const [notice, setNotice] = useState("");

  const draft = active ? drafts[active.id] || "" : "";
  const setDraft = (value: string) => active && setDrafts((current) => ({ ...current, [active.id]: value }));
  const open = (item: Channel, parent: Message | null = null) => { setActive(item); activeRef.current = item; setThreadParent(parent); if (!parent) setThreadOrigin(null); setMode("chat"); setError(null); };
  const back = () => {
    if (mode === "chat" && threadParent && threadOrigin) { open(threadOrigin); return; }
    if (mode === "chat") { setMode("conversations"); setActive(null); activeRef.current = null; setThreadParent(null); return; }
    setMode("servers");
  };
  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  useEffect(() => { void readSession().then(({ accessToken }) => { setLoggedIn(Boolean(accessToken)); setReady(true); }); }, []);
  useEffect(() => {
    if (!loggedIn) return;
    void getServers().then((rows) => { serversRef.current = rows; setServers(rows); setServer((current) => rows.find((row) => row.id === navigationRef.current?.serverId) ?? (current && rows.some((row) => row.id === current.id) ? current : rows[0] ?? null)); }).catch(report);
  }, [loggedIn]);
  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    serverRef.current = server;
    setChannels([]);
    channelsRef.current = [];
    setActive(null);
    activeRef.current = null;
    activeRequestRef.current += 1;
    setMode("conversations");
    void Promise.all([getChannels(server.id), getDMs(server.id)]).then(([regular, dms]) => {
      if (cancelled) return;
      const items = [...regular.filter((item) => item.joined !== false && !item.archivedAt), ...dms];
      channelsRef.current = items;
      setChannels(items);
      const target = navigationRef.current;
      if (target?.serverId === server.id) {
        const found = items.find((item) => item.id === target.channelId);
        if (found) open(found);
        else void getChannel(server.id, target.channelId).then((row) => { if (!cancelled) open(row); }).catch(report);
        navigationRef.current = null;
      }
    }).catch(report);
    void registerForPush(server.id).catch(() => undefined);
    return () => { cancelled = true; };
  }, [server]);
  useEffect(() => {
    if (!server) return;
    let closed = false;
    const cacheMessage = (row: Message) => {
      if (closed) return;
      messageCacheRef.current.merge(server.id, [row]);
      const next = messageCacheRef.current.get(server.id, row.channelId);
      if (serverRef.current?.id === server.id && activeRef.current?.id === row.channelId) setMessages(next);
    };
    const syncServer = async () => {
      if (syncingServerRef.current.has(server.id)) return;
      syncingServerRef.current.add(server.id);
      try {
        let cursor = serverCursorRef.current.get(server.id) ?? 0;
        while (!closed) {
          const rows = await import("./src/api").then(({ api }) => api<Message[]>(`/api/messages/sync?since_seq=${cursor}&limit=200`, {}, server.id));
          if (closed || rows.length === 0) break;
          rows.map(normalize).forEach(cacheMessage);
          const nextCursor = Math.max(cursor, ...rows.map((row) => row.seq ?? 0));
          if (nextCursor <= cursor) break;
          cursor = nextCursor;
          serverCursorRef.current.set(server.id, cursor);
          if (rows.length < 200) break;
        }
      } catch {
        // Retry from the last complete page on a later reconnect.
      } finally { syncingServerRef.current.delete(server.id); }
    };
    syncServerRef.current = () => { void syncServer(); };
    const handle = createRaftSocket(server.id, () => serverCursorRef.current.get(server.id) ?? 0, (row) => {
      cacheMessage(normalize(row));
    }, (payload) => {
      if (typeof payload.body === "string") setNotice(payload.body);
    }, (currentSeq, hasMore) => {
      // Advance only after the server confirms the final ordered page.
      if (!hasMore) serverCursorRef.current.set(server.id, Math.max(serverCursorRef.current.get(server.id) ?? 0, currentSeq));
    }, (serverSeq) => {
      if (serverSeq > (checkedServerSeqRef.current.get(server.id) ?? 0)) {
        void syncServer().then(() => checkedServerSeqRef.current.set(server.id, serverSeq));
      }
    }, () => { void syncServer(); }, () => {
      setLoggedIn(false);
      setError("登录已失效，请重新登录");
    });
    socketRef.current = handle;
    return () => { closed = true; if (socketRef.current === handle) socketRef.current = null; syncServerRef.current = null; handle(); };
  }, [server]);
  useEffect(() => {
    if (!server || !active) return;
    let cancelled = false;
    const requestId = ++activeRequestRef.current;
    const serverId = server.id;
    const channelId = active.id;
    setMessages([]); setHasOlder(false); setLoading(true);
    void getMessages(serverId, channelId).then((result) => {
      if (cancelled) return;
      const rows = result.messages.map(normalize);
      messageCacheRef.current.merge(serverId, rows);
      const next = messageCacheRef.current.get(serverId, channelId);
      if (requestId === activeRequestRef.current && serverRef.current?.id === serverId && activeRef.current?.id === channelId) {
        setMessages(next);
        setHasOlder(rows.length >= 50 && !result.historyLimited);
        setLoading(false);
      }
    }).catch((e) => { if (!cancelled) { report(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, [server, active]);
  useEffect(() => {
    if (!loggedIn) return;
    return subscribeToNotificationTap((payload) => {
      const targetServerId = payload.serverId;
      const targetChannelId = payload.channelId;
      if (typeof targetServerId !== "string" || typeof targetChannelId !== "string") return;
      const found = channelsRef.current.find((item) => item.id === targetChannelId);
      if (serverRef.current?.id === targetServerId && found) open(found);
      else if (serverRef.current?.id === targetServerId) void getChannel(targetServerId, targetChannelId).then((row) => open(row)).catch(report);
      else {
        navigationRef.current = { serverId: targetServerId, channelId: targetChannelId };
        const target = serversRef.current.find((item) => item.id === targetServerId);
        if (target) setServer(target);
        else void getServers().then((rows) => { serversRef.current = rows; setServers(rows); const row = rows.find((item) => item.id === targetServerId); if (row) setServer(row); });
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
    const oldest = Math.min(...messages.map((m) => m.seq ?? Number.MAX_SAFE_INTEGER));
    if (!Number.isFinite(oldest)) return;
    loadingOlder.current = true;
    try {
      const result = await getMessages(serverId, channelId, oldest);
      const rows = result.messages.map(normalize);
      messageCacheRef.current.merge(serverId, rows);
      const next = messageCacheRef.current.get(serverId, channelId);
      if (requestId === activeRequestRef.current && serverRef.current?.id === serverId && activeRef.current?.id === channelId) {
        setMessages(next);
        setHasOlder(rows.length >= 50 && !result.historyLimited);
      }
    } catch (e) { report(e); } finally { loadingOlder.current = false; }
  };
  const submitLogin = async () => { setError(null); try { await login(email.trim(), password); setLoggedIn(true); } catch (e) { report(e); } };
  const logout = async () => {
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
    messageCacheRef.current.clear();
    serverCursorRef.current.clear();
    setLoggedIn(false);
    setServer(null);
    setActive(null);
  };
  const submitMessage = async () => {
    const content = draft.trim();
    if (!content || !server || !active || sending) return;
    const serverId = server.id;
    const channelId = active.id;
    setSending(true); setDraft("");
    try {
      const response = await sendMessage(serverId, channelId, content);
      const row = normalize((response as any).message ?? response);
      messageCacheRef.current.merge(serverId, [row]);
      const next = messageCacheRef.current.get(serverId, channelId);
      if (serverRef.current?.id === serverId && activeRef.current?.id === channelId) { setMessages(next); list.current?.scrollToOffset({ offset: 0, animated: true }); }
    }
    catch (e) { if (serverRef.current?.id === serverId && activeRef.current?.id === channelId) setDraft(content); report(e); }
    finally { setSending(false); }
  };
  const openThread = async (parent: Message) => {
    if (!server || !active || active.type === "thread") return;
    const serverId = server.id;
    const origin = active;
    try { const result = await getOrCreateThread(serverId, origin.id, parent.id); if (serverRef.current?.id !== serverId || activeRef.current?.id !== origin.id) return; setThreadOrigin(origin); open({ id: result.threadChannelId, name: `回复 · ${displayName(origin)}`, type: "thread", serverId }, parent); }
    catch (e) { report(e); }
  };
  const title = useMemo(() => active ? displayName(active) : "消息", [active]);

  if (!ready) return <View style={styles.center}><ActivityIndicator color={color.blue} /></View>;
  if (!loggedIn) return <SafeAreaView style={styles.safe}><StatusBar style="dark" /><View style={styles.login}><Text style={styles.brand}>Raft</Text><Text style={styles.loginTitle}>登录你的工作区</Text><TextInput value={email} onChangeText={setEmail} placeholder="邮箱" autoCapitalize="none" keyboardType="email-address" textContentType="username" style={styles.input} /><TextInput value={password} onChangeText={setPassword} placeholder="密码" secureTextEntry textContentType="password" style={styles.input} /><Pressable style={styles.primary} onPress={() => void submitLogin()}><Text style={styles.primaryLabel}>登录</Text></Pressable>{error ? <Text style={styles.error}>{error}</Text> : null}</View></SafeAreaView>;
  return <SafeAreaView style={styles.safe}><StatusBar style="dark" />
    <View style={styles.header}><Pressable onPress={back}><Text style={styles.headerAction}>{mode === "chat" ? threadParent ? "‹ 频道" : "‹ 消息" : mode === "servers" ? "‹ 返回" : "工作区"}</Text></Pressable><Text numberOfLines={1} style={styles.headerTitle}>{mode === "chat" ? title : server?.name || "Raft"}</Text><Pressable onPress={() => void logout()}><Text style={styles.headerAction}>退出</Text></Pressable></View>
    {error ? <Pressable onPress={() => setError(null)} style={styles.errorBar}><Text numberOfLines={2} style={styles.error}>{error}</Text></Pressable> : null}
    {mode === "servers" ? <FlatList data={servers} keyExtractor={(item) => item.id} contentContainerStyle={styles.listPad} renderItem={({ item }) => <Pressable style={styles.conversationRow} onPress={() => { setServer(item); setMode("conversations"); }}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.muted}>{item.slug}</Text></Pressable>} /> : null}
    {mode === "conversations" ? <FlatList data={channels} keyExtractor={(item) => item.id} contentContainerStyle={styles.listPad} renderItem={({ item }) => <Pressable style={styles.conversationRow} onPress={() => open(item)}><Text style={styles.rowTitle}>{item.type === "dm" ? "@" : "#"} {displayName(item)}</Text><Text style={styles.muted}>{item.type === "dm" ? "私信" : "频道"}</Text></Pressable>} ListEmptyComponent={<View style={styles.center}><Text style={styles.muted}>暂无已加入的频道或私信</Text></View>} /> : null}
    {mode === "chat" ? <KeyboardAvoidingView style={styles.chat} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>{threadParent ? <View style={styles.threadParent}><Text style={styles.muted}>回复 {threadParent.senderName}</Text><Text numberOfLines={2}>{threadParent.content}</Text></View> : null}<FlatList ref={list} inverted data={messages} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.messages} renderItem={({ item }) => <Pressable style={styles.message} onPress={() => void openThread(item)}><View style={styles.messageHeader}><Text style={styles.sender}>{item.senderName}</Text><Text style={styles.time}>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text></View><Text style={styles.content}>{item.content}</Text></Pressable>} onEndReached={() => void loadOlder()} onEndReachedThreshold={0.3} ListFooterComponent={loading ? <ActivityIndicator color={color.blue} /> : null} initialNumToRender={20} maxToRenderPerBatch={15} windowSize={7} removeClippedSubviews={Platform.OS !== "ios"} maintainVisibleContentPosition={{ minIndexForVisible: 0 }} /><View style={styles.composer}><TextInput value={draft} onChangeText={setDraft} placeholder="写消息…" multiline maxLength={32000} style={styles.composerInput} textAlignVertical="top" /><Pressable style={[styles.send, (!draft.trim() || sending) && styles.disabled]} disabled={!draft.trim() || sending} accessibilityLabel="发送消息" onPress={() => void submitMessage()}><Text style={styles.sendLabel}>发送</Text></Pressable></View></KeyboardAvoidingView> : null}
    {notice ? <Pressable style={styles.notice} onPress={() => setNotice("")}><Text numberOfLines={2} style={styles.noticeText}>{notice}</Text></Pressable> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: color.white }, center: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 160 }, login: { flex: 1, justifyContent: "center", padding: 28 }, brand: { fontSize: 42, fontWeight: "800", color: color.blue }, loginTitle: { fontSize: 24, fontWeight: "700", color: color.ink, marginTop: 10, marginBottom: 24 }, input: { borderWidth: 1, borderColor: color.line, borderRadius: 12, padding: 14, marginBottom: 12, fontSize: 16 }, primary: { backgroundColor: color.blue, padding: 15, borderRadius: 12, alignItems: "center" }, primaryLabel: { color: color.white, fontSize: 16, fontWeight: "700" }, error: { color: "#B91C1C", fontSize: 13 }, errorBar: { backgroundColor: "#FEF2F2", padding: 8 }, header: { height: 54, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: color.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, headerAction: { color: color.blue, fontSize: 14, minWidth: 54 }, headerTitle: { color: color.ink, fontSize: 17, fontWeight: "700", maxWidth: "52%" }, listPad: { paddingBottom: 20 }, conversationRow: { minHeight: 68, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: color.line, paddingHorizontal: 18 }, rowTitle: { color: color.ink, fontSize: 16, fontWeight: "600" }, muted: { color: color.muted, fontSize: 12, marginTop: 3 }, chat: { flex: 1 }, threadParent: { padding: 10, backgroundColor: color.bg, borderBottomWidth: 1, borderBottomColor: color.line }, messages: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 }, message: { padding: 10, marginBottom: 8, borderRadius: 12, backgroundColor: color.bg }, messageHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }, sender: { color: color.ink, fontSize: 13, fontWeight: "700" }, time: { color: color.muted, fontSize: 11 }, content: { color: color.ink, fontSize: 16, lineHeight: 23 }, composer: { flexDirection: "row", alignItems: "flex-end", borderTopWidth: 1, borderTopColor: color.line, padding: 10, gap: 8, backgroundColor: color.white }, composerInput: { flex: 1, maxHeight: 140, minHeight: 44, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: color.line, fontSize: 16, color: color.ink }, send: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, backgroundColor: color.blue, borderRadius: 12 }, disabled: { opacity: 0.4 }, sendLabel: { color: color.white, fontWeight: "700" }, notice: { position: "absolute", bottom: 92, left: 12, right: 12, padding: 12, borderRadius: 10, backgroundColor: color.ink }, noticeText: { color: color.white } });
