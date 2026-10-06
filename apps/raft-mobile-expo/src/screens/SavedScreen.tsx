import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { formatStage2Date, getSavedMessages, unsaveMessage, type SavedMessage } from "../stage2Api";

type Props = { serverId: string; onOpenMessage?: (item: SavedMessage) => void };

export function SavedScreen({ serverId, onOpenMessage }: Props) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SavedMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { const response = await getSavedMessages(serverId, { q: query, limit: 50 }); setRows(response.saved); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [query, serverId]);
  useEffect(() => { void load(); }, [load]);
  const remove = async (item: SavedMessage) => { await unsaveMessage(serverId, item.messageId); setRows((current) => current.filter((row) => row.messageId !== item.messageId)); };
  return <View style={styles.root}>
    <View style={styles.header}><Text style={styles.title}>保存</Text><Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel="刷新保存消息"><Text style={styles.refresh}>刷新</Text></Pressable></View>
    <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void load()} placeholder="筛选已保存消息" style={styles.input} accessibilityLabel="筛选已保存消息" />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {busy && !rows.length ? <ActivityIndicator style={styles.loading} /> : null}
    <FlatList data={rows} keyExtractor={(item) => item.messageId} contentContainerStyle={styles.list} renderItem={({ item }) => <Pressable style={styles.card} onPress={() => onOpenMessage?.(item)} accessibilityRole="button"><Text style={styles.meta}>{item.channelName} · {item.senderName || "Raft"}</Text><Text style={styles.content}>{item.content}</Text><View style={styles.footer}><Text style={styles.time}>{formatStage2Date(item.savedAt)}</Text><Pressable onPress={() => void remove(item)} accessibilityRole="button" accessibilityLabel="取消保存"><Text style={styles.remove}>取消保存</Text></Pressable></View></Pressable>} ListEmptyComponent={!busy ? <Text style={styles.empty}>暂无保存消息</Text> : null} />
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, padding: 16, backgroundColor: "#F6F8FB" }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, title: { fontSize: 24, fontWeight: "700", color: "#17212F" }, refresh: { color: "#365FE8" }, input: { marginVertical: 12, borderWidth: 1, borderColor: "#E5EAF0", borderRadius: 10, backgroundColor: "#FFF", paddingHorizontal: 12, paddingVertical: 10 }, list: { gap: 8 }, card: { backgroundColor: "#FFF", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#E5EAF0" }, meta: { color: "#718096", fontSize: 12, marginBottom: 6 }, content: { color: "#17212F", fontSize: 15 }, footer: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 }, time: { color: "#A0AEC0", fontSize: 11 }, remove: { color: "#C53030", fontSize: 12 }, error: { color: "#C53030" }, empty: { color: "#718096", textAlign: "center", padding: 24 }, loading: { padding: 16 } });
