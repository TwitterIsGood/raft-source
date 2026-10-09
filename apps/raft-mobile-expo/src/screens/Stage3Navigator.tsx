import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { getChannels } from "../api";
import { getSessionGeneration } from "../session";
import { getCurrentUser } from "../settingsApi";
import { API_BASE_URL, WEB_APP_URL } from "../config";
import { addServerMember, claimTask, createServerInvite, createServerJoinLink, createTask, getServerComputers, getServerGuestFlag, getServerInvites, getServerJoinLinks, getServerMembers, getServerTasks, getWikiDirectory, getWikiPage, getWikiStatus, refreshWiki, removeServerMember, revokeServerInvite, revokeServerJoinLink, setTaskStatus, updateServerComputer, updateServerMemberRole, type MobileComputer, type MobileInvite, type MobileJoinLink, type MobileMember, type MobileTask, type WikiArtifact, type WikiPage } from "../stage3Api";
import { canRemoveStage3Member, createStage3InviteRequestTracker, createStage3RequestTracker, filterStage3Members, getEditableStage3MemberRoles, getStage3AddMemberRoles, isStage3ResponseCurrent, STAGE3_ROUTES, type Stage3Route, type Stage3ServerRole } from "../stage3Navigation";
import { isWikiExternalUrl, parseWikiBlocks, resolveWikiAssetUrl, splitWikiInline, type WikiBlock } from "../wikiRender";

type Props = { serverId: string };

function ErrorText({ message }: { message: string | null }) { return message ? <Text style={styles.error}>{message}</Text> : null; }

export function Stage3Navigator({ serverId }: Props) {
  const [route, setRoute] = useState<Stage3Route>("tasks");
  return <View style={styles.root}>
    <View style={styles.body}>
      {route === "tasks" ? <TasksPanel serverId={serverId} />
        : route === "wiki" ? <WikiPanel serverId={serverId} />
          : route === "members" ? <MembersPanel serverId={serverId} />
            : <ComputersPanel serverId={serverId} />}
    </View>
    <View style={styles.tabs} accessibilityRole="tablist">
      {STAGE3_ROUTES.map(({ route: key, title }) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: route === key }} accessibilityLabel={title} onPress={() => setRoute(key)} style={styles.tab}><Text style={[styles.tabText, route === key && styles.selected]}>{title}</Text></Pressable>)}
    </View>
  </View>;
}

function TasksPanel({ serverId }: Props) {
  const [rows, setRows] = useState<MobileTask[]>([]); const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Array<{ id: string; name?: string | null; type?: string }>>([]);
  const [filter, setFilter] = useState<"all" | MobileTask["status"]>("all");
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false); const [title, setTitle] = useState(""); const [channelId, setChannelId] = useState<string | null>(null); const [mutating, setMutating] = useState<string | null>(null);
  const load = useCallback(async () => { setBusy(true); setError(null); try { setRows((await getServerTasks(serverId)).tasks); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }, [serverId]);
  useEffect(() => { void load(); }, [load]);
  const openCreate = async () => { setError(null); try { const available = (await getChannels(serverId)).filter((item) => item.type !== "dm" && item.type !== "thread" && item.joined !== false && !item.archivedAt); setChannels(available); setChannelId(available[0]?.id ?? null); setTitle(""); setCreateOpen(true); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const submitCreate = async () => { if (!channelId || !title.trim()) return; setMutating("create"); setError(null); try { const result = await createTask(serverId, channelId, title.trim()); setRows((current) => [...current, ...(result.tasks ?? [])]); setCreateOpen(false); setTitle(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setMutating(null); } };
  const mutateTask = async (item: MobileTask, action: "claim" | MobileTask["status"]) => { setMutating(item.id); setError(null); try { const result = action === "claim" ? await claimTask(serverId, item.id) : await setTaskStatus(serverId, item.id, action); setRows((current) => current.map((row) => row.id === item.id ? result.task : row)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setMutating(null); } };
  const statusAction = (status: MobileTask["status"]) => status === "todo" ? "in_progress" : status === "in_progress" ? "in_review" : status === "in_review" ? "done" : status === "done" ? "closed" : "todo";
  const visibleRows = rows.filter((item) => (filter === "all" || item.status === filter) && (!channelFilter || item.channelId === channelFilter) && (!query.trim() || `${item.title} ${item.description ?? ""} ${item.channelName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())));
  return <View style={styles.panel}><View style={styles.header}><Text style={styles.title}>任务</Text><View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel="新建任务" onPress={() => void openCreate()}><Text style={styles.action}>新建</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="刷新任务" onPress={() => void load()}><Text style={styles.action}>刷新</Text></Pressable></View></View><TextInput accessibilityLabel="搜索任务" value={query} onChangeText={setQuery} placeholder="搜索任务、频道…" style={styles.filterInput} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{(["all", "todo", "in_progress", "in_review", "done", "closed"] as const).map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={[styles.filterChip, filter === value && styles.filterChipSelected]}><Text style={filter === value ? styles.filterChipTextSelected : styles.filterChipText}>{value === "all" ? "全部" : value}</Text></Pressable>)}{Array.from(new Map(rows.map((item) => [item.channelId, item.channelName || item.channelId])).entries()).map(([id, name]) => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: channelFilter === id }} onPress={() => setChannelFilter(channelFilter === id ? null : id)} style={[styles.filterChip, channelFilter === id && styles.filterChipSelected]}><Text style={channelFilter === id ? styles.filterChipTextSelected : styles.filterChipText}>{name}</Text></Pressable>)}</ScrollView><ErrorText message={error} />{busy ? <ActivityIndicator /> : <FlatList data={visibleRows} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>{rows.length ? "没有符合条件的任务" : "暂无任务"}</Text>} renderItem={({ item }) => { const next = statusAction(item.status); return <View style={styles.card}><Text style={styles.meta}>task #{item.taskNumber}{item.channelName ? ` · ${item.channelName}` : ""}</Text><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.meta}>{item.status}{item.claimedByName ? ` · ${item.claimedByName}` : ""}</Text>{item.description ? <Text style={styles.bodyText}>{item.description}</Text> : null}<View style={styles.cardActions}>{!item.claimedById ? <Pressable accessibilityRole="button" accessibilityLabel={`认领任务 ${item.taskNumber}`} disabled={mutating === item.id} onPress={() => void mutateTask(item, "claim")}><Text style={styles.action}>{mutating === item.id ? "处理中…" : "认领"}</Text></Pressable> : null}<Pressable accessibilityRole="button" accessibilityLabel={`任务 ${item.taskNumber} 移至 ${next}`} disabled={mutating === item.id} onPress={() => void mutateTask(item, next)}><Text style={styles.action}>移至 {next}</Text></Pressable></View></View>; }} />}
    <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>新建任务</Text><TextInput autoFocus value={title} onChangeText={setTitle} placeholder="任务标题" accessibilityLabel="任务标题" style={styles.modalInput} /><Text style={styles.meta}>选择频道</Text><View style={styles.channelChoices}>{channels.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: channelId === item.id }} onPress={() => setChannelId(item.id)} style={[styles.channelChoice, channelId === item.id && styles.channelChoiceSelected]}><Text>{item.name || item.id}</Text></Pressable>)}</View><View style={styles.modalActions}><Pressable accessibilityRole="button" onPress={() => setCreateOpen(false)}><Text style={styles.action}>取消</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="确认新建任务" disabled={!channelId || !title.trim() || mutating === "create"} onPress={() => void submitCreate()}><Text style={[styles.action, (!channelId || !title.trim() || mutating === "create") && styles.disabledText]}>{mutating === "create" ? "创建中…" : "创建"}</Text></Pressable></View></View></View></Modal>
  </View>;
}

function WikiPanel({ serverId }: Props) {
  const [status, setStatus] = useState<string>("加载中"); const [rows, setRows] = useState<WikiArtifact[]>([]); const [error, setError] = useState<string | null>(null); const [refreshing, setRefreshing] = useState(false);
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null); const [pageBusy, setPageBusy] = useState(false);
  const load = useCallback(async () => { setError(null); try { const current = await getWikiStatus(serverId); const value = current.space?.status ?? "不可用"; setStatus(value); if (value !== "不可用") { const directory = await getWikiDirectory(serverId); setRows(directory.pages ?? []); } else setRows([]); } catch (e) { setStatus("不可用"); setRows([]); setError(e instanceof Error ? e.message : String(e)); } }, [serverId]);
  useEffect(() => { void load(); }, [load]);
  const triggerRefresh = async () => { setRefreshing(true); setError(null); try { await refreshWiki(serverId); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setRefreshing(false); } };
  const openPage = async (item: WikiArtifact) => {
    setPageBusy(true); setError(null);
    try { setSelectedPage(await getWikiPage(serverId, item.id)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPageBusy(false); }
  };
  if (selectedPage) {
    const body = selectedPage.markdown ?? selectedPage.content ?? selectedPage.summary ?? "暂无正文";
    return <View style={styles.panel}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="返回Wiki目录" onPress={() => setSelectedPage(null)}><Text style={styles.action}>‹ Wiki</Text></Pressable><Text numberOfLines={1} style={styles.title}>{selectedPage.title}</Text></View><ScrollView accessibilityLabel="Wiki正文" style={styles.wikiBody}>{parseWikiBlocks(body).map((block, index) => <WikiBlockView key={`${block.kind}-${index}`} block={block} />)}</ScrollView></View>;
  }
  return <View style={styles.panel}><View style={styles.header}><Text style={styles.title}>Wiki</Text><Pressable accessibilityRole="button" accessibilityLabel="刷新Wiki" disabled={refreshing} onPress={() => void triggerRefresh()}><Text style={[styles.action, refreshing && styles.disabledText]}>{refreshing ? "刷新中…" : "刷新"}</Text></Pressable></View><Text style={styles.meta}>状态：{status}</Text><ErrorText message={error} />{pageBusy ? <ActivityIndicator /> : <FlatList data={rows} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>暂无可用 Wiki 页面</Text>} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`打开Wiki页面 ${item.title}`} style={styles.card} onPress={() => void openPage(item)}><Text style={styles.cardTitle}>{item.title}</Text>{item.summary ? <Text style={styles.bodyText}>{item.summary}</Text> : null}</Pressable>} />}</View>;
}

function WikiBlockView({ block }: { block: WikiBlock }) {
  if (block.kind === "image") return <WikiImageBlock block={block} />;
  if (block.kind === "heading") return <Text style={[styles.wikiHeading, block.level === 1 ? styles.wikiH1 : block.level === 2 ? styles.wikiH2 : styles.wikiH3]}><WikiInline text={block.text} /></Text>;
  if (block.kind === "bullet") return <View style={styles.wikiBullet}><Text style={styles.wikiBulletMark}>•</Text><Text style={styles.bodyText}><WikiInline text={block.text} /></Text></View>;
  if (block.kind === "ordered") return <View style={styles.wikiBullet}><Text style={styles.wikiBulletMark}>{block.index}.</Text><Text style={styles.bodyText}><WikiInline text={block.text} /></Text></View>;
  if (block.kind === "code") return <ScrollView horizontal style={styles.wikiCode}><Text style={styles.wikiCodeText}>{block.text}</Text></ScrollView>;
  return <Text style={styles.bodyText}><WikiInline text={block.text} /></Text>;
}

function WikiImageBlock({ block }: { block: Extract<WikiBlock, { kind: "image" }> }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const uri = resolveWikiAssetUrl(block.url, API_BASE_URL);
  return <View style={styles.wikiImageBlock}>
    <Image accessibilityLabel={`Wiki图片 ${block.alt || "图片"}`} source={{ uri }} resizeMode="contain" style={styles.wikiImage} onLoad={() => setState("loaded")} onError={() => setState("failed")} />
    <Text style={styles.meta}>{state === "loaded" ? `图片已加载：${block.alt}` : state === "failed" ? `图片加载失败：${block.alt}` : `图片加载中：${block.alt}`}</Text>
  </View>;
}

function WikiInline({ text }: { text: string }) {
  const [linkError, setLinkError] = useState(false);
  const parts = splitWikiInline(text);
  const openLink = (url: string) => {
    if (!isWikiExternalUrl(url)) {
      setLinkError(true);
      return;
    }
    void Linking.openURL(url).catch(() => setLinkError(true));
  };
  return <>{parts.map((part, index) => part.url ? <Text key={index} accessibilityRole="link" style={[styles.wikiLink, part.strong && styles.wikiStrong]} onPress={() => openLink(part.url!)}>{part.text}</Text> : <Text key={index} style={part.strong ? styles.wikiStrong : undefined}>{part.text}</Text>)}{linkError ? <Text accessibilityLabel="链接打开失败" style={styles.wikiLinkError}>链接打开失败</Text> : null}</>;
}

function MembersPanel({ serverId }: Props) {
  const [rows, setRows] = useState<MobileMember[]>([]); const [query, setQuery] = useState(""); const [error, setError] = useState<string | null>(null); const [actorUserId, setActorUserId] = useState<string | null>(null); const [busyUserId, setBusyUserId] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false); const [addUserId, setAddUserId] = useState(""); const [addRole, setAddRole] = useState<Exclude<Stage3ServerRole, "guest">>("member"); const [removeTarget, setRemoveTarget] = useState<MobileMember | null>(null);
  const [invites, setInvites] = useState<MobileInvite[]>([]); const [joinLinks, setJoinLinks] = useState<MobileJoinLink[]>([]); const [guestEnabled, setGuestEnabled] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false); const [inviteEmail, setInviteEmail] = useState(""); const [inviteRole, setInviteRole] = useState<"member" | "guest">("member"); const [inviteBusy, setInviteBusy] = useState(false); const [inviteError, setInviteError] = useState<string | null>(null); const [linkBusy, setLinkBusy] = useState(false); const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const requestTracker = useRef(createStage3RequestTracker()); const mutationGeneration = useRef(0); const inviteTracker = useRef(createStage3InviteRequestTracker());
  const visibleRows = filterStage3Members(rows, query);
  const load = useCallback(async (expectedMutation?: number) => {
    if (expectedMutation === undefined) mutationGeneration.current += 1;
    const token = requestTracker.current.beginRequest();
    const sessionGeneration = getSessionGeneration();
    setLoading(true);
    setRows([]);
    setActorUserId(null);
    if (expectedMutation === undefined) setBusyUserId(null);
    setError(null);
    try {
      const [items, user] = await Promise.all([getServerMembers(serverId), getCurrentUser()]);
      if (!isStage3ResponseCurrent(requestTracker.current, token, sessionGeneration, getSessionGeneration()) || (expectedMutation !== undefined && mutationGeneration.current !== expectedMutation)) return false;
      setRows(items);
      setActorUserId(user.id);
      setLoading(false);
      return true;
    } catch (e) {
      if (isStage3ResponseCurrent(requestTracker.current, token, sessionGeneration, getSessionGeneration()) && (expectedMutation === undefined || mutationGeneration.current === expectedMutation)) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
      return false;
    }
  }, [serverId]);
  useEffect(() => {
    requestTracker.current.beginScope();
    mutationGeneration.current += 1;
    // Do not let the previous workspace's rows or actor permissions remain
    // visible while the new scope is loading.
    setRows([]);
    setActorUserId(null);
    setBusyUserId(null);
    inviteTracker.current.beginScope();
    setInvites([]); setJoinLinks([]); setGuestEnabled(false); setInviteOpen(false); setInviteEmail(""); setInviteRole("member"); setInviteBusy(false); setLinkBusy(false); setCopiedLinkId(null); setInviteError(null);
    void load();
    return () => {
      requestTracker.current.beginScope();
      mutationGeneration.current += 1;
      // Invalidate invite/list/copy callbacks when leaving the members page,
      // even if the session remains active. This prevents late responses from
      // repopulating invite state after the panel has been unmounted.
      inviteTracker.current.beginScope();
    };
  }, [load]);
  const actorRole = rows.find((item) => item.userId === actorUserId)?.role ?? null;
  const ownerCount = rows.filter((item) => item.role === "owner").length;
  const membersReady = !loading && actorUserId !== null;
  const canInvite = membersReady && (actorRole === "owner" || actorRole === "admin");
  const roleLabel = (role: Stage3ServerRole) => role === "owner" ? "所有者" : role === "admin" ? "管理员" : role === "member" ? "成员" : "访客";
  const saveRole = async (member: MobileMember, nextRole: Stage3ServerRole) => {
    const scope = requestTracker.current.currentScope(); const operation = ++mutationGeneration.current; const sessionGeneration = getSessionGeneration();
    setBusyUserId(member.userId); setError(null);
    try {
      if (!requestTracker.current.isScopeCurrent(scope) || getSessionGeneration() !== sessionGeneration) return;
      await updateServerMemberRole(serverId, member.userId, nextRole);
      if (!requestTracker.current.isScopeCurrent(scope) || getSessionGeneration() !== sessionGeneration || mutationGeneration.current !== operation) return;
      // Re-read the authoritative membership row after the mutation.
      await load(operation);
    } catch (e) {
      if (requestTracker.current.isScopeCurrent(scope) && mutationGeneration.current === operation && getSessionGeneration() === sessionGeneration) setError(stage3ErrorMessage(e));
    } finally {
      if (requestTracker.current.isScopeCurrent(scope) && mutationGeneration.current === operation && getSessionGeneration() === sessionGeneration) setBusyUserId(null);
    }
  };
  const beginAdd = () => {
    const allowed = getStage3AddMemberRoles(actorRole);
    if (!allowed.length) return;
    setAddUserId(""); setAddRole(allowed.includes("member") ? "member" : allowed[0]); setError(null); setAddOpen(true);
  };
  const submitAdd = async () => {
    const userId = addUserId.trim();
    const allowed = getStage3AddMemberRoles(actorRole);
    if (!userId || !allowed.includes(addRole)) return;
    const scope = requestTracker.current.currentScope(); const operation = ++mutationGeneration.current; const sessionGeneration = getSessionGeneration();
    setBusyUserId("add"); setError(null);
    try {
      await addServerMember(serverId, userId, addRole);
      if (!requestTracker.current.isScopeCurrent(scope) || getSessionGeneration() !== sessionGeneration || mutationGeneration.current !== operation) return;
      await load(operation);
      if (requestTracker.current.isScopeCurrent(scope) && mutationGeneration.current === operation && getSessionGeneration() === sessionGeneration) { setAddOpen(false); setAddUserId(""); }
    } catch (e) {
      if (requestTracker.current.isScopeCurrent(scope) && mutationGeneration.current === operation && getSessionGeneration() === sessionGeneration) setError(stage3ErrorMessage(e));
    } finally {
      if (requestTracker.current.isScopeCurrent(scope) && mutationGeneration.current === operation && getSessionGeneration() === sessionGeneration) setBusyUserId(null);
    }
  };
  const confirmRemove = async () => {
    const member = removeTarget;
    if (!member) return;
    const scope = requestTracker.current.currentScope(); const operation = ++mutationGeneration.current; const sessionGeneration = getSessionGeneration();
    setBusyUserId(member.userId); setError(null);
    try {
      await removeServerMember(serverId, member.userId);
      if (!requestTracker.current.isScopeCurrent(scope) || getSessionGeneration() !== sessionGeneration || mutationGeneration.current !== operation) return;
      await load(operation);
      if (requestTracker.current.isScopeCurrent(scope) && mutationGeneration.current === operation && getSessionGeneration() === sessionGeneration) setRemoveTarget(null);
    } catch (e) {
      if (requestTracker.current.isScopeCurrent(scope) && mutationGeneration.current === operation && getSessionGeneration() === sessionGeneration) setError(stage3ErrorMessage(e));
    } finally {
      if (requestTracker.current.isScopeCurrent(scope) && mutationGeneration.current === operation && getSessionGeneration() === sessionGeneration) setBusyUserId(null);
    }
  };
  const loadInvites = useCallback(async () => {
    const operation = inviteTracker.current.beginRead();
    const sessionGeneration = getSessionGeneration();
    const current = () => inviteTracker.current.isReadCurrent(operation) && getSessionGeneration() === sessionGeneration;
    if (!canInvite) { if (current()) { setInvites([]); setJoinLinks([]); setGuestEnabled(false); } return; }
    try {
      const [inviteRows, linkRows, guest] = await Promise.all([getServerInvites(serverId), getServerJoinLinks(serverId), getServerGuestFlag(serverId)]);
      if (current()) { setInvites(inviteRows); setJoinLinks(linkRows); setGuestEnabled(guest); setInviteError(null); }
    } catch (e) {
      if (current()) setInviteError(stage3ErrorMessage(e));
    }
  }, [canInvite, serverId]);
  useEffect(() => { void loadInvites(); }, [loadInvites]);
  const submitInvite = async () => {
    const email = inviteEmail.trim();
    if (!email || inviteBusy) return;
    const requestedRole = inviteRole;
    if (requestedRole === "guest" && !guestEnabled) {
      setInviteError("访客邀请开关已关闭，请重新选择成员");
      return;
    }
    const operation = inviteTracker.current.beginInviteWrite(); const sessionGeneration = getSessionGeneration();
    const current = () => inviteTracker.current.isInviteWriteCurrent(operation) && getSessionGeneration() === sessionGeneration;
    setInviteBusy(true); setInviteError(null);
    try { const created = await createServerInvite(serverId, email, requestedRole); if (current()) { setInvites((items) => [created, ...items]); setInviteEmail(""); setInviteRole("member"); setInviteOpen(false); } }
    catch (e) { if (current()) setInviteError(stage3ErrorMessage(e)); }
    finally { if (current()) setInviteBusy(false); }
  };
  const revokeInvite = async (invite: MobileInvite) => {
    const operation = inviteTracker.current.beginInviteWrite(); const sessionGeneration = getSessionGeneration();
    const current = () => inviteTracker.current.isInviteWriteCurrent(operation) && getSessionGeneration() === sessionGeneration;
    setInviteBusy(true); setInviteError(null);
    try { await revokeServerInvite(serverId, invite.id); if (current()) setInvites((items) => items.filter((row) => row.id !== invite.id)); }
    catch (e) { if (current()) setInviteError(stage3ErrorMessage(e)); }
    finally { if (current()) setInviteBusy(false); }
  };
  const createLink = async () => {
    if (linkBusy) return;
    const operation = inviteTracker.current.beginLinkWrite(); const sessionGeneration = getSessionGeneration();
    const current = () => inviteTracker.current.isLinkWriteCurrent(operation) && getSessionGeneration() === sessionGeneration;
    setLinkBusy(true); setInviteError(null);
    try { const created = await createServerJoinLink(serverId, { expiresAt: null, maxUses: null }); if (current()) setJoinLinks((items) => [created.link, ...items]); }
    catch (e) { if (current()) setInviteError(stage3ErrorMessage(e)); }
    finally { if (current()) setLinkBusy(false); }
  };
  const revokeLink = async (link: MobileJoinLink) => {
    const operation = inviteTracker.current.beginLinkWrite(); const sessionGeneration = getSessionGeneration();
    const current = () => inviteTracker.current.isLinkWriteCurrent(operation) && getSessionGeneration() === sessionGeneration;
    setLinkBusy(true); setInviteError(null);
    try { await revokeServerJoinLink(serverId, link.id); if (current()) setJoinLinks((items) => items.filter((row) => row.id !== link.id)); }
    catch (e) { if (current()) setInviteError(stage3ErrorMessage(e)); }
    finally { if (current()) setLinkBusy(false); }
  };
  const copyLink = async (link: MobileJoinLink) => {
    if (!WEB_APP_URL) { setInviteError("未配置 Web 入口，无法复制加入链接"); return; }
    const scope = requestTracker.current.currentScope();
    const sessionGeneration = getSessionGeneration();
    const current = () => requestTracker.current.isScopeCurrent(scope) && getSessionGeneration() === sessionGeneration;
    const url = `${WEB_APP_URL}/join/${link.token}`;
    try {
      await Clipboard.setStringAsync(url);
      if (!current()) return;
      setInviteError(null);
      setCopiedLinkId(link.id);
      setTimeout(() => { if (current()) setCopiedLinkId((value) => value === link.id ? null : value); }, 1500);
    } catch (error) {
      if (current()) { setCopiedLinkId(null); setInviteError(`复制加入链接失败：${stage3ErrorMessage(error)}`); }
    }
  };
  const emptyLabel = rows.length > 0 && query.trim() ? `没有匹配的成员：${query.trim()}` : "暂无成员";
  const addRoles = membersReady ? getStage3AddMemberRoles(actorRole) : [];
  return <View style={styles.panel}><View style={styles.header}><Text style={styles.title}>成员</Text><View style={styles.headerActions}>{canInvite ? <Pressable accessibilityRole="button" accessibilityLabel="邀请成员" disabled={Boolean(busyUserId)} onPress={() => { setInviteError(null); setInviteEmail(""); setInviteOpen(true); }}><Text style={styles.action}>邀请</Text></Pressable> : null}{addRoles.length ? <Pressable accessibilityRole="button" accessibilityLabel="添加成员" disabled={Boolean(busyUserId)} onPress={beginAdd}><Text style={styles.action}>添加</Text></Pressable> : null}<Pressable accessibilityRole="button" accessibilityLabel="刷新成员" disabled={loading || Boolean(busyUserId) || inviteBusy || linkBusy} onPress={() => void load()}><Text style={[styles.action, (loading || busyUserId || inviteBusy || linkBusy) && styles.disabledText]}>刷新</Text></Pressable></View></View><TextInput accessibilityLabel="搜索成员" placeholder="搜索成员" value={query} onChangeText={setQuery} style={styles.filterInput} autoCapitalize="none" autoCorrect={false} /><ErrorText message={error} />{inviteError ? <ErrorText message={inviteError} /> : null}{canInvite ? <View style={styles.invitePanel}><View style={styles.inviteHeader}><Text style={styles.meta}>邮箱邀请</Text><Pressable accessibilityRole="button" accessibilityLabel="创建加入链接" disabled={linkBusy} onPress={() => void createLink()}><Text style={[styles.action, linkBusy && styles.disabledText]}>{linkBusy ? "创建中…" : "创建加入链接"}</Text></Pressable></View>{joinLinks.slice(0, 2).map((link) => <View key={link.id} style={styles.inviteRow}><Text numberOfLines={1} style={styles.bodyText}>加入链接 · {link.token.slice(0, 4)}…{link.token.slice(-4)}</Text><View style={styles.cardActions}><Pressable accessibilityRole="button" accessibilityLabel={`复制加入链接 ${link.id}`} onPress={() => void copyLink(link)}><Text style={styles.action}>{copiedLinkId === link.id ? "已复制" : "复制"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`撤销加入链接 ${link.id}`} disabled={linkBusy} onPress={() => void revokeLink(link)}><Text style={styles.action}>撤销</Text></Pressable></View></View>)}{invites.slice(0, 3).map((invite) => <View key={invite.id} style={styles.inviteRow}><Text numberOfLines={1} style={styles.bodyText}>{invite.invitedEmail} · {roleLabel(invite.role === "guest" ? "guest" : "member")}</Text><Pressable accessibilityRole="button" accessibilityLabel={`撤销邮箱邀请 ${invite.id}`} disabled={inviteBusy} onPress={() => void revokeInvite(invite)}><Text style={styles.action}>撤销</Text></Pressable></View>)}</View> : null}{loading ? <ActivityIndicator accessibilityLabel="加载成员" /> : null}<FlatList data={visibleRows} keyExtractor={(item) => item.userId} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>{emptyLabel}</Text>} renderItem={({ item }) => { const roles = membersReady ? getEditableStage3MemberRoles({ actorRole, targetRole: item.role, isSelf: item.userId === actorUserId, ownerCount }) : []; const canRemove = membersReady && canRemoveStage3Member({ actorRole, targetRole: item.role, isSelf: item.userId === actorUserId, ownerCount }); return <View style={styles.card}><Text style={styles.cardTitle}>{item.displayName || item.name}</Text><Text style={styles.meta}>角色：{roleLabel(item.role)}</Text>{item.description ? <Text style={styles.bodyText}>{item.description}</Text> : null}{roles.length || canRemove ? <View style={styles.cardActions}>{roles.map((role) => { const activate = () => void saveRole(item, role); return <Pressable key={role} accessibilityRole="button" accessibilityLabel={`将 ${item.displayName || item.name} 设为${roleLabel(role)}`} disabled={busyUserId === item.userId} onPress={activate}><Text style={[styles.action, busyUserId === item.userId && styles.disabledText]}>设为{roleLabel(role)}</Text></Pressable>; })}{canRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`移除成员 ${item.displayName || item.name}`} disabled={Boolean(busyUserId)} onPress={() => setRemoveTarget(item)}><Text style={[styles.action, busyUserId && styles.disabledText]}>移除</Text></Pressable> : null}</View> : null}</View>; }} /><Modal visible={inviteOpen} transparent animationType="slide" onRequestClose={() => { if (!inviteBusy) setInviteOpen(false); }}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>邀请成员</Text><Text style={styles.bodyText}>输入邮箱地址；不会直接加入成员。</Text><TextInput accessibilityLabel="邀请邮箱" placeholder="name@example.com" value={inviteEmail} onChangeText={setInviteEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" returnKeyType="done" onSubmitEditing={() => void submitInvite()} style={styles.modalInput} />{guestEnabled ? <><Text style={styles.meta}>角色</Text><View style={styles.cardActions}><Pressable accessibilityRole="button" accessibilityState={{ selected: inviteRole === "member" }} onPress={() => setInviteRole("member")}><Text style={[styles.action, inviteRole === "member" && styles.selected]}>成员</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ selected: inviteRole === "guest" }} onPress={() => setInviteRole("guest")}><Text style={[styles.action, inviteRole === "guest" && styles.selected]}>访客</Text></Pressable></View></> : <Text style={styles.meta}>访客邀请由服务器开关控制</Text>}<View style={styles.modalActions}><Pressable accessibilityRole="button" disabled={inviteBusy} onPress={() => setInviteOpen(false)}><Text style={styles.action}>取消</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="确认发送邀请" disabled={!inviteEmail.trim() || inviteBusy} onPress={() => void submitInvite()}><Text style={styles.action}>{inviteBusy ? "发送中…" : "发送"}</Text></Pressable></View></View></View></Modal><Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => { if (!busyUserId) setAddOpen(false); }}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>添加成员</Text><Text style={styles.bodyText}>输入隔离测试成员的 user ID。</Text><TextInput accessibilityLabel="成员 user ID" placeholder="user ID" value={addUserId} onChangeText={setAddUserId} autoCapitalize="none" autoCorrect={false} returnKeyType="done" blurOnSubmit onSubmitEditing={() => void submitAdd()} style={styles.modalInput} /><Text style={styles.meta}>角色</Text><View style={styles.cardActions}>{addRoles.map((role) => <Pressable key={role} accessibilityRole="button" accessibilityState={{ selected: addRole === role }} onPress={() => setAddRole(role)}><Text style={[styles.action, addRole === role && styles.selected]}>{roleLabel(role)}</Text></Pressable>)}</View><View style={styles.modalActions}><Pressable accessibilityRole="button" disabled={Boolean(busyUserId)} onPress={() => setAddOpen(false)}><Text style={styles.action}>取消</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="确认添加成员" disabled={!addUserId.trim() || Boolean(busyUserId)} onPress={() => void submitAdd()}><Text style={[styles.action, (!addUserId.trim() || busyUserId) && styles.disabledText]}>{busyUserId === "add" ? "添加中…" : "添加"}</Text></Pressable></View></View></View></Modal><Modal visible={Boolean(removeTarget)} transparent animationType="fade" onRequestClose={() => { if (!busyUserId) setRemoveTarget(null); }}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>移除成员</Text><Text style={styles.bodyText}>确定移除“{removeTarget?.displayName || removeTarget?.name}”？此操作会从服务器成员列表中移除该成员。</Text><View style={styles.modalActions}><Pressable accessibilityRole="button" disabled={Boolean(busyUserId)} onPress={() => setRemoveTarget(null)}><Text style={styles.action}>取消</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="确认移除成员" disabled={Boolean(busyUserId)} onPress={() => void confirmRemove()}><Text style={[styles.action, busyUserId && styles.disabledText]}>{busyUserId ? "移除中…" : "确认移除"}</Text></Pressable></View></View></View></Modal></View>;
}

function stage3ErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try { const parsed = JSON.parse(raw) as { error?: unknown }; return typeof parsed.error === "string" ? parsed.error : raw; } catch { return raw; }
}

function ComputersPanel({ serverId }: Props) {
  const [rows, setRows] = useState<MobileComputer[]>([]); const [error, setError] = useState<string | null>(null); const [editing, setEditing] = useState<MobileComputer | null>(null); const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setError(null); try { setRows(await getServerComputers(serverId)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, [serverId]);
  useEffect(() => { void load(); }, [load]);
  const saveName = async () => { if (!editing || !name.trim()) return; setBusy(true); setError(null); try { const updated = await updateServerComputer(serverId, editing.id, { name: name.trim() }); setRows((current) => current.map((row) => row.id === updated.id ? updated : row)); setEditing(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <View style={styles.panel}><View style={styles.header}><Text style={styles.title}>电脑</Text><Pressable accessibilityRole="button" accessibilityLabel="刷新电脑" onPress={() => void load()}><Text style={styles.action}>刷新</Text></Pressable></View><ErrorText message={error} /><FlatList data={rows} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>暂无电脑</Text>} renderItem={({ item }) => <View style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.meta}>{item.status} · {item.os || "系统未知"}</Text>{item.hostname ? <Text style={styles.bodyText}>{item.hostname}</Text> : null}<View style={styles.cardActions}><Pressable accessibilityRole="button" accessibilityLabel={`重命名电脑 ${item.name}`} onPress={() => { setEditing(item); setName(item.name); }}><Text style={styles.action}>重命名</Text></Pressable></View></View>} /><Modal visible={Boolean(editing)} transparent animationType="slide" onRequestClose={() => setEditing(null)}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>重命名电脑</Text><TextInput selectTextOnFocus value={name} onChangeText={setName} placeholder="电脑名称" accessibilityLabel="电脑名称" returnKeyType="done" blurOnSubmit onSubmitEditing={() => void saveName()} style={styles.modalInput} /><View style={styles.modalActions}><Pressable accessibilityRole="button" onPress={() => setEditing(null)}><Text style={styles.action}>取消</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="确认重命名电脑" disabled={!name.trim() || busy} onPress={() => void saveName()}><Text style={[styles.action, (!name.trim() || busy) && styles.disabledText]}>{busy ? "保存中…" : "保存"}</Text></Pressable></View></View></View></Modal></View>;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#F6F8FB" }, body: { flex: 1 }, panel: { flex: 1, padding: 16 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, headerActions: { flexDirection: "row", gap: 14 }, title: { fontSize: 24, fontWeight: "700", color: "#17212F", marginBottom: 10 }, action: { color: "#365FE8" }, disabledText: { opacity: 0.4 }, list: { gap: 8, paddingVertical: 8 }, card: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#E5EAF0", backgroundColor: "#FFF" }, invitePanel: { marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#E5EAF0", backgroundColor: "#FFF" }, inviteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, inviteRow: { borderTopWidth: 1, borderTopColor: "#F0F2F5", paddingTop: 8, marginTop: 8 }, cardTitle: { color: "#17212F", fontWeight: "700" }, cardActions: { flexDirection: "row", gap: 16, marginTop: 10 }, meta: { color: "#718096", fontSize: 12, marginTop: 4 }, bodyText: { color: "#4A5568", marginTop: 6, lineHeight: 21 }, filterInput: { minHeight: 42, borderWidth: 1, borderColor: "#CBD5E0", borderRadius: 8, paddingHorizontal: 10, color: "#17212F", marginTop: 8 }, filterRow: { gap: 8, paddingVertical: 8 }, filterChip: { borderWidth: 1, borderColor: "#CBD5E0", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#FFF" }, filterChipSelected: { borderColor: "#365FE8", backgroundColor: "#E8EEFF" }, filterChipText: { color: "#4A5568", fontSize: 12 }, filterChipTextSelected: { color: "#365FE8", fontSize: 12, fontWeight: "700" }, wikiBody: { flex: 1, marginTop: 8, padding: 12, borderWidth: 1, borderColor: "#E5EAF0", borderRadius: 10, backgroundColor: "#FFF" }, wikiHeading: { color: "#17212F", fontWeight: "700", marginTop: 12, marginBottom: 5 }, wikiH1: { fontSize: 24 }, wikiH2: { fontSize: 20 }, wikiH3: { fontSize: 17 }, wikiBullet: { flexDirection: "row", alignItems: "flex-start", gap: 8 }, wikiBulletMark: { color: "#365FE8", fontSize: 20, lineHeight: 24 }, wikiLink: { color: "#365FE8", textDecorationLine: "underline" }, wikiStrong: { fontWeight: "700" }, wikiLinkError: { color: "#C53030", marginLeft: 8 }, wikiImageBlock: { marginVertical: 12 }, wikiImage: { width: "100%", height: 180, backgroundColor: "#F6F8FB", borderRadius: 8 }, wikiCode: { marginVertical: 8, padding: 10, backgroundColor: "#17212F", borderRadius: 8 }, wikiCodeText: { color: "#FFF", fontFamily: "Menlo" }, empty: { color: "#718096", textAlign: "center", padding: 24 }, error: { color: "#C53030", marginBottom: 8 }, tabs: { flexDirection: "row", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#E5EAF0", backgroundColor: "#FFF" }, tab: { flex: 1, alignItems: "center", paddingVertical: 8 }, tabText: { color: "#718096" }, selected: { color: "#365FE8", fontWeight: "700" }, modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.3)" }, modalCard: { backgroundColor: "#FFF", padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16 }, modalTitle: { color: "#17212F", fontSize: 20, fontWeight: "700", marginBottom: 14 }, modalInput: { borderWidth: 1, borderColor: "#E5EAF0", borderRadius: 8, padding: 10, color: "#17212F", marginBottom: 14 }, channelChoices: { gap: 8, marginVertical: 8 }, channelChoice: { padding: 10, borderRadius: 8, backgroundColor: "#F6F8FB" }, channelChoiceSelected: { borderWidth: 1, borderColor: "#365FE8", backgroundColor: "#E8EEFF" }, modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 18, marginTop: 14 },
});
