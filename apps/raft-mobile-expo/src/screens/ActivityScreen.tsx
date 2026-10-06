import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { formatStage2Date, getActivityInbox, type ActivityFilter, type ActivityInboxRow } from "../stage2Api";

type Props = { serverId: string; onOpenRow?: (row: ActivityInboxRow) => void };

export function ActivityScreen({ serverId, onOpenRow }: Props) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [rows, setRows] = useState<ActivityInboxRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { const response = await getActivityInbox(serverId, { filter, limit: 30 }); setRows(response.items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [filter, serverId]);
  useEffect(() => { void load(); }, [load]);
  return <View style={styles.root}>
    <View style={styles.header}><Text style={styles.title}>动态</Text><Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel="刷新动态"><Text style={styles.refresh}>刷新</Text></Pressable></View>
    <View style={styles.filters}>{(["all", "unread", "mentions"] as const).map((item) => <Pressable key={item} onPress={() => setFilter(item)} accessibilityRole="button"><Text style={[styles.filter, item === filter && styles.selected]}>{item === "all" ? "全部" : item === "unread" ? "未读" : "提及"}</Text></Pressable>)}</View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {busy && !rows.length ? <ActivityIndicator style={styles.loading} /> : null}
    <FlatList data={rows} keyExtractor={(item) => item.kind === "thread" ? `thread:${item.threadChannelId}` : `${item.kind}:${item.channelId}`} contentContainerStyle={styles.list} renderItem={({ item }) => <Pressable style={styles.card} onPress={() => onOpenRow?.(item)} accessibilityRole="button"><View style={styles.rowHeader}><Text style={styles.name}>{item.channelName || item.parentChannelName || "动态"}</Text>{item.unreadCount > 0 ? <Text style={styles.badge}>{item.unreadCount}</Text> : null}</View><Text style={styles.preview}>{item.lastMessagePreview || item.latestActivityPreview || item.parentMessagePreview || "有新动态"}</Text><Text style={styles.time}>{formatStage2Date(item.lastActivityAt || item.lastMessageAt)}</Text></Pressable>} ListEmptyComponent={!busy ? <Text style={styles.empty}>暂无动态</Text> : null} />
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, padding: 16, backgroundColor: "#F6F8FB" }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, title: { fontSize: 24, fontWeight: "700", color: "#17212F" }, refresh: { color: "#365FE8" }, filters: { flexDirection: "row", gap: 20, paddingVertical: 14 }, filter: { color: "#718096" }, selected: { color: "#365FE8", fontWeight: "700" }, list: { gap: 8 }, card: { backgroundColor: "#FFF", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#E5EAF0" }, rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, name: { color: "#17212F", fontWeight: "600" }, badge: { color: "#FFF", backgroundColor: "#365FE8", borderRadius: 10, paddingHorizontal: 7, overflow: "hidden", fontSize: 11 }, preview: { color: "#4A5568", marginTop: 6 }, time: { color: "#A0AEC0", fontSize: 11, marginTop: 8 }, error: { color: "#C53030" }, empty: { color: "#718096", textAlign: "center", padding: 24 }, loading: { padding: 16 } });
