import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { checkSavedMessages, formatStage2Date, saveMessage, searchMessages, unsaveMessage, type SearchResult, type Stage2SearchSort } from "../stage2Api";

type Props = { serverId: string; onOpenMessage?: (result: SearchResult) => void };

export function SearchScreen({ serverId, onOpenMessage }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Stage2SearchSort>("relevance");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (offset = 0) => {
    setBusy(true); setError(null);
    try {
      const response = await searchMessages(serverId, { q: query, sort, limit: 20, offset });
      setResults((previous) => offset ? [...previous, ...response.results] : response.results);
      setHasMore(response.hasMore);
      const ids = response.results.map((item) => item.id);
      if (ids.length) {
        const saved = await checkSavedMessages(serverId, ids);
        setSavedIds((current) => new Set([...current, ...saved.savedIds]));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [query, serverId, sort]);
  return <View style={styles.root}>
    <Text style={styles.title}>搜索</Text>
    <View style={styles.controls}>
      <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void run()} placeholder="搜索消息" returnKeyType="search" style={styles.input} accessibilityLabel="搜索消息" />
      <Pressable onPress={() => void run()} disabled={busy} style={styles.button} accessibilityRole="button" accessibilityLabel="执行搜索"><Text style={styles.buttonText}>搜索</Text></Pressable>
    </View>
    <View style={styles.sortRow}><Pressable onPress={() => setSort("relevance")} accessibilityRole="button"><Text style={[styles.sort, sort === "relevance" && styles.selected]}>相关度</Text></Pressable><Pressable onPress={() => setSort("recent")} accessibilityRole="button"><Text style={[styles.sort, sort === "recent" && styles.selected]}>最近</Text></Pressable></View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {busy && !results.length ? <ActivityIndicator style={styles.loading} /> : null}
    <FlatList data={results} extraData={savedIds} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} onEndReached={() => { if (hasMore && !busy) void run(results.length); }} renderItem={({ item }) => <View style={styles.card}><Pressable onPress={() => onOpenMessage?.(item)} accessibilityRole="button" accessibilityLabel={`打开搜索结果 ${item.channelName} ${item.content}`}><Text style={styles.meta}>{item.channelName} · {item.senderName}</Text><Text style={styles.content}>{item.snippet || item.content}</Text><Text style={styles.time}>{formatStage2Date(item.createdAt)}</Text></Pressable><Pressable style={styles.saveButton} accessibilityRole="button" accessibilityLabel={savedIds.has(item.id) ? "取消保存" : "保存消息"} onPress={async () => { const wasSaved = savedIds.has(item.id); setSavedIds((current) => { const next = new Set(current); if (wasSaved) next.delete(item.id); else next.add(item.id); return next; }); try { if (wasSaved) await unsaveMessage(serverId, item.id); else await saveMessage(serverId, item.id); } catch (cause) { setSavedIds((current) => { const next = new Set(current); if (wasSaved) next.add(item.id); else next.delete(item.id); return next; }); setError(cause instanceof Error ? cause.message : String(cause)); } }}><Text style={styles.saveText}>{savedIds.has(item.id) ? "取消保存" : "保存"}</Text></Pressable></View>} ListEmptyComponent={!busy ? <Text style={styles.empty}>输入关键词开始搜索</Text> : null} />
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, padding: 16, backgroundColor: "#F6F8FB" }, title: { fontSize: 24, fontWeight: "700", color: "#17212F", marginBottom: 12 }, controls: { flexDirection: "row", gap: 8 }, input: { flex: 1, borderWidth: 1, borderColor: "#E5EAF0", borderRadius: 10, backgroundColor: "#FFF", paddingHorizontal: 12, paddingVertical: 10 }, button: { borderRadius: 10, backgroundColor: "#365FE8", justifyContent: "center", paddingHorizontal: 16 }, buttonText: { color: "#FFF", fontWeight: "600" }, sortRow: { flexDirection: "row", gap: 20, paddingVertical: 12 }, sort: { color: "#718096" }, selected: { color: "#365FE8", fontWeight: "700" }, list: { gap: 8 }, card: { backgroundColor: "#FFF", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#E5EAF0" }, meta: { color: "#718096", fontSize: 12, marginBottom: 4 }, content: { color: "#17212F", fontSize: 15 }, time: { color: "#A0AEC0", fontSize: 11, marginTop: 8 }, saveButton: { alignSelf: "flex-start", marginTop: 10, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#EEF2FF" }, saveText: { color: "#365FE8", fontSize: 12, fontWeight: "600" }, error: { color: "#C53030", marginBottom: 8 }, empty: { color: "#718096", textAlign: "center", padding: 24 }, loading: { padding: 16 } });
