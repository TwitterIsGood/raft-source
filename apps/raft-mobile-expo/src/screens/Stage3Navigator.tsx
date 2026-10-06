import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { getServerComputers, getServerMembers, getServerTasks, getWikiDirectory, getWikiStatus, type MobileComputer, type MobileMember, type MobileTask, type WikiArtifact } from "../stage3Api";
import { STAGE3_ROUTES, type Stage3Route } from "../stage3Navigation";

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
  const load = useCallback(async () => { setBusy(true); setError(null); try { setRows((await getServerTasks(serverId)).tasks); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }, [serverId]);
  useEffect(() => { void load(); }, [load]);
  return <View style={styles.panel}><View style={styles.header}><Text style={styles.title}>任务</Text><Pressable accessibilityRole="button" accessibilityLabel="刷新任务" onPress={() => void load()}><Text style={styles.action}>刷新</Text></Pressable></View><ErrorText message={error} />{busy ? <ActivityIndicator /> : <FlatList data={rows} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>暂无任务</Text>} renderItem={({ item }) => <View style={styles.card}><Text style={styles.cardTitle}>task #{item.taskNumber} · {item.title}</Text><Text style={styles.meta}>{item.status}{item.claimedByName ? ` · ${item.claimedByName}` : ""}</Text>{item.description ? <Text style={styles.bodyText}>{item.description}</Text> : null}</View>} />}</View>;
}

function WikiPanel({ serverId }: Props) {
  const [status, setStatus] = useState<string>("加载中"); const [rows, setRows] = useState<WikiArtifact[]>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let cancelled = false; (async () => { try { const current = await getWikiStatus(serverId); if (cancelled) return; const value = current.space?.status ?? "不可用"; setStatus(value); if (value !== "不可用") { const directory = await getWikiDirectory(serverId); if (!cancelled) setRows(directory.pages ?? []); } } catch (e) { if (!cancelled) { setStatus("不可用"); setError(e instanceof Error ? e.message : String(e)); } } })(); return () => { cancelled = true; }; }, [serverId]);
  return <View style={styles.panel}><Text style={styles.title}>Wiki</Text><Text style={styles.meta}>状态：{status}</Text><ErrorText message={error} /><FlatList data={rows} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>暂无可用 Wiki 页面</Text>} renderItem={({ item }) => <View style={styles.card}><Text style={styles.cardTitle}>{item.title}</Text>{item.summary ? <Text style={styles.bodyText}>{item.summary}</Text> : null}</View>} /></View>;
}

function MembersPanel({ serverId }: Props) {
  const [rows, setRows] = useState<MobileMember[]>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let cancelled = false; getServerMembers(serverId).then((items) => { if (!cancelled) setRows(items); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }); return () => { cancelled = true; }; }, [serverId]);
  return <View style={styles.panel}><Text style={styles.title}>成员</Text><ErrorText message={error} /><FlatList data={rows} keyExtractor={(item) => item.userId} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>暂无成员</Text>} renderItem={({ item }) => <View style={styles.card}><Text style={styles.cardTitle}>{item.displayName || item.name}</Text><Text style={styles.meta}>{item.role}</Text>{item.description ? <Text style={styles.bodyText}>{item.description}</Text> : null}</View>} /></View>;
}

function ComputersPanel({ serverId }: Props) {
  const [rows, setRows] = useState<MobileComputer[]>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let cancelled = false; getServerComputers(serverId).then((result) => { if (!cancelled) setRows(result.machines ?? []); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }); return () => { cancelled = true; }; }, [serverId]);
  return <View style={styles.panel}><Text style={styles.title}>电脑</Text><ErrorText message={error} /><FlatList data={rows} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>暂无电脑</Text>} renderItem={({ item }) => <View style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.meta}>{item.status} · {item.os || "系统未知"}</Text>{item.hostname ? <Text style={styles.bodyText}>{item.hostname}</Text> : null}</View>} /></View>;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#F6F8FB" }, body: { flex: 1 }, panel: { flex: 1, padding: 16 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, title: { fontSize: 24, fontWeight: "700", color: "#17212F", marginBottom: 10 }, action: { color: "#365FE8" }, list: { gap: 8, paddingVertical: 8 }, card: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#E5EAF0", backgroundColor: "#FFF" }, cardTitle: { color: "#17212F", fontWeight: "700" }, meta: { color: "#718096", fontSize: 12, marginTop: 4 }, bodyText: { color: "#4A5568", marginTop: 6 }, empty: { color: "#718096", textAlign: "center", padding: 24 }, error: { color: "#C53030", marginBottom: 8 }, tabs: { flexDirection: "row", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#E5EAF0", backgroundColor: "#FFF" }, tab: { flex: 1, alignItems: "center", paddingVertical: 8 }, tabText: { color: "#718096" }, selected: { color: "#365FE8", fontWeight: "700" } });
