import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Button, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { checkSavedMessages, formatStage2Date, saveMessage, searchMessages, unsaveMessage, type SearchResult, type Stage2SearchSort } from "../stage2Api";
import { isCurrentSearchGeneration, reconcileSavedIds } from "../stage2Search";
import { enqueueMessageMutation } from "../stage2SaveQueue";

type Props = { serverId: string; onOpenMessage?: (result: SearchResult) => void };

export function SearchScreen({ serverId, onOpenMessage }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Stage2SearchSort>("relevance");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const busyRef = useRef(false);
  const submittedRef = useRef<{ q: string; sort: Stage2SearchSort }>({ q: "", sort: "relevance" });
  const savedMutationGeneration = useRef(new Map<string, number>());
  const savedMutationQueue = useRef(new Map<string, Promise<unknown>>());
  const savedIntent = useRef(new Map<string, boolean>());
  const toggleSaved = (item: SearchResult) => {
    const wasSaved = savedIntent.current.has(item.id) ? Boolean(savedIntent.current.get(item.id)) : Boolean(savedIds[item.id]);
    const nextSaved = !wasSaved;
    savedIntent.current.set(item.id, nextSaved);
    const mutation = (savedMutationGeneration.current.get(item.id) ?? 0) + 1;
    savedMutationGeneration.current.set(item.id, mutation);
    setSavedIds((current) => ({ ...current, [item.id]: nextSaved }));
    setResults((current) => current.map((row) => row.id === item.id ? { ...row } : row));
    void enqueueMessageMutation(savedMutationQueue.current, item.id, async () => {
      await (wasSaved ? unsaveMessage(serverId, item.id) : saveMessage(serverId, item.id));
      const saved = await checkSavedMessages(serverId, [item.id]);
      if (savedMutationGeneration.current.get(item.id) === mutation) {
        savedIntent.current.set(item.id, saved.savedIds.includes(item.id));
        setSavedIds((current) => ({ ...current, [item.id]: saved.savedIds.includes(item.id) }));
      }
    }).catch((cause) => {
      if (savedMutationGeneration.current.get(item.id) !== mutation) return;
      savedIntent.current.set(item.id, wasSaved);
      setSavedIds((current) => ({ ...current, [item.id]: wasSaved }));
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };
  const run = useCallback(async (offset = 0) => {
    if (offset > 0 && busyRef.current) return;
    const generation = offset === 0 ? requestGeneration.current + 1 : requestGeneration.current;
    if (offset === 0) {
      requestGeneration.current = generation;
      submittedRef.current = { q: query.trim(), sort };
    }
    const submitted = submittedRef.current;
    busyRef.current = true;
    setBusy(true); setError(null);
    try {
      const response = await searchMessages(serverId, { q: submitted.q, sort: submitted.sort, limit: 20, offset });
      if (!isCurrentSearchGeneration(requestGeneration.current, generation)) return;
      setResults((previous) => offset ? [...previous, ...response.results] : response.results);
      setHasMore(response.hasMore);
      const ids = response.results.map((item) => item.id);
      if (ids.length) {
        const mutationSnapshot = new Map(ids.map((id) => [id, savedMutationGeneration.current.get(id) ?? 0]));
        const saved = await checkSavedMessages(serverId, ids);
        if (!isCurrentSearchGeneration(requestGeneration.current, generation)) return;
        setSavedIds((current) => {
          const next = reconcileSavedIds(current, ids, saved.savedIds, mutationSnapshot, savedMutationGeneration.current);
          for (const id of ids) {
            if ((savedMutationGeneration.current.get(id) ?? 0) === 0) savedIntent.current.set(id, Boolean(next[id]));
          }
          return next;
        });
      } else if (!offset) {
        savedIntent.current.clear();
        setSavedIds({});
      }
    } catch (cause) {
      if (isCurrentSearchGeneration(requestGeneration.current, generation)) setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
      if (isCurrentSearchGeneration(requestGeneration.current, generation)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [query, serverId, sort]);
  return <View style={styles.root}>
    <Text style={styles.title}>搜索</Text>
    <View style={styles.controls}>
      <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => { Keyboard.dismiss(); void run(); }} placeholder="搜索消息" returnKeyType="search" style={styles.input} accessibilityLabel="搜索消息" />
      <Pressable onPress={() => { Keyboard.dismiss(); void run(); }} disabled={busy} style={styles.button} accessibilityRole="button" accessibilityLabel="执行搜索"><Text style={styles.buttonText}>搜索</Text></Pressable>
    </View>
    <View style={styles.sortRow}><Pressable onPress={() => setSort("relevance")} accessibilityRole="button"><Text style={[styles.sort, sort === "relevance" && styles.selected]}>相关度</Text></Pressable><Pressable onPress={() => setSort("recent")} accessibilityRole="button"><Text style={[styles.sort, sort === "recent" && styles.selected]}>最近</Text></Pressable></View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {busy && !results.length ? <ActivityIndicator style={styles.loading} /> : null}
    <FlatList data={results} extraData={savedIds} keyExtractor={(item) => `${item.id}:${savedIds[item.id] ? "saved" : "unsaved"}`} contentContainerStyle={styles.list} onEndReached={() => { if (hasMore) void run(results.length); }} renderItem={({ item }) => <View style={styles.card}><Pressable onPress={() => onOpenMessage?.(item)} accessibilityRole="button" accessibilityLabel={`打开搜索结果 ${item.channelName} ${item.content}`}><Text style={styles.meta}>{item.channelName} · {item.senderName}</Text><Text style={styles.content}>{item.snippet || item.content}</Text><Text style={styles.time}>{formatStage2Date(item.createdAt)}</Text></Pressable><Button title={savedIds[item.id] ? "取消保存" : "保存"} accessibilityLabel={savedIds[item.id] ? "取消保存" : "保存消息"} onPress={() => toggleSaved(item)} /></View>} ListEmptyComponent={!busy ? <Text style={styles.empty}>输入关键词开始搜索</Text> : null} />
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, padding: 16, backgroundColor: "#F6F8FB" }, title: { fontSize: 24, fontWeight: "700", color: "#17212F", marginBottom: 12 }, controls: { flexDirection: "row", gap: 8 }, input: { flex: 1, borderWidth: 1, borderColor: "#E5EAF0", borderRadius: 10, backgroundColor: "#FFF", paddingHorizontal: 12, paddingVertical: 10 }, button: { borderRadius: 10, backgroundColor: "#365FE8", justifyContent: "center", paddingHorizontal: 16 }, buttonText: { color: "#FFF", fontWeight: "600" }, sortRow: { flexDirection: "row", gap: 20, paddingVertical: 12 }, sort: { color: "#718096" }, selected: { color: "#365FE8", fontWeight: "700" }, list: { gap: 8 }, card: { backgroundColor: "#FFF", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#E5EAF0" }, meta: { color: "#718096", fontSize: 12, marginBottom: 4 }, content: { color: "#17212F", fontSize: 15 }, time: { color: "#A0AEC0", fontSize: 11, marginTop: 8 }, saveButton: { alignSelf: "flex-start", marginTop: 10, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#EEF2FF" }, saveText: { color: "#365FE8", fontSize: 12, fontWeight: "600" }, error: { color: "#C53030", marginBottom: 8 }, empty: { color: "#718096", textAlign: "center", padding: 24 }, loading: { padding: 16 } });
