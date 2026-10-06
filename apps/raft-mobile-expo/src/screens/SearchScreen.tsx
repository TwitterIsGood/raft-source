import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { searchMessages, type SearchResult, type Stage2SearchSort } from "../stage2Api";

type Props = { serverId: string; onOpenMessage?: (result: SearchResult) => void };

export function SearchScreen({ serverId, onOpenMessage }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Stage2SearchSort>("relevance");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (offset = 0) => {
    setBusy(true); setError(null);
    try {
      const response = await searchMessages(serverId, { q: query, sort, limit: 20, offset });
      setResults((previous) => offset ? [...previous, ...response.results] : response.results);
      setHasMore(response.hasMore);
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
    <FlatList data={results} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} onEndReached={() => { if (hasMore && !busy) void run(results.length); }} renderItem={({ item }) => <Pressable style={styles.card} onPress={() => onOpenMessage?.(item)} accessibilityRole="button"><Text style={styles.meta}>{item.channelName} · {item.senderName}</Text><Text style={styles.content}>{item.snippet || item.content}</Text><Text style={styles.time}>{new Date(item.createdAt).toLocaleString()}</Text></Pressable>} ListEmptyComponent={!busy ? <Text style={styles.empty}>输入关键词开始搜索</Text> : null} />
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, padding: 16, backgroundColor: "#F6F8FB" }, title: { fontSize: 24, fontWeight: "700", color: "#17212F", marginBottom: 12 }, controls: { flexDirection: "row", gap: 8 }, input: { flex: 1, borderWidth: 1, borderColor: "#E5EAF0", borderRadius: 10, backgroundColor: "#FFF", paddingHorizontal: 12, paddingVertical: 10 }, button: { borderRadius: 10, backgroundColor: "#365FE8", justifyContent: "center", paddingHorizontal: 16 }, buttonText: { color: "#FFF", fontWeight: "600" }, sortRow: { flexDirection: "row", gap: 20, paddingVertical: 12 }, sort: { color: "#718096" }, selected: { color: "#365FE8", fontWeight: "700" }, list: { gap: 8 }, card: { backgroundColor: "#FFF", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#E5EAF0" }, meta: { color: "#718096", fontSize: 12, marginBottom: 4 }, content: { color: "#17212F", fontSize: 15 }, time: { color: "#A0AEC0", fontSize: 11, marginTop: 8 }, error: { color: "#C53030", marginBottom: 8 }, empty: { color: "#718096", textAlign: "center", padding: 24 }, loading: { padding: 16 } });
