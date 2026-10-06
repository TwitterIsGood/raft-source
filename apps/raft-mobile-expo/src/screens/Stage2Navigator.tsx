import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ActivityScreen } from "./ActivityScreen";
import { SavedScreen } from "./SavedScreen";
import { SearchScreen } from "./SearchScreen";
import { createStage2Navigation, navigateStage2, STAGE2_ROUTES, type Stage2NavigationState, type Stage2Route } from "../stage2Navigation";
import type { ActivityInboxRow, SavedMessage, SearchResult } from "../stage2Api";

type Props = {
  serverId: string;
  initialRoute?: Stage2Route;
  onOpenSearchResult?: (result: SearchResult) => void;
  onOpenActivityRow?: (row: ActivityInboxRow) => void;
  onOpenSavedMessage?: (item: SavedMessage) => void;
};

/** Isolated stage-2 navigation surface; App.tsx can mount it after review. */
export function Stage2Navigator({ serverId, initialRoute = "activity", onOpenSearchResult, onOpenActivityRow, onOpenSavedMessage }: Props) {
  const [navigation, setNavigation] = useState<Stage2NavigationState>(() => createStage2Navigation(serverId, initialRoute));
  const select = (route: Stage2Route) => setNavigation((current) => navigateStage2(current, route));
  return <View style={styles.root}>
    <View style={styles.content}>
      {navigation.route === "search" ? <SearchScreen serverId={navigation.serverId} onOpenMessage={onOpenSearchResult} />
        : navigation.route === "saved" ? <SavedScreen serverId={navigation.serverId} onOpenMessage={onOpenSavedMessage} />
          : <ActivityScreen serverId={navigation.serverId} onOpenRow={onOpenActivityRow} />}
    </View>
    <View style={styles.tabBar} accessibilityRole="tablist">{STAGE2_ROUTES.map((entry) => <Pressable key={entry.route} onPress={() => select(entry.route)} accessibilityRole="tab" accessibilityState={{ selected: navigation.route === entry.route }} accessibilityLabel={entry.title} style={styles.tab}><Text style={[styles.icon, navigation.route === entry.route && styles.selected]}>{entry.icon}</Text><Text style={[styles.label, navigation.route === entry.route && styles.selected]}>{entry.title}</Text></Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#F6F8FB" }, content: { flex: 1 }, tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#E5EAF0", backgroundColor: "#FFF", paddingBottom: 8, paddingTop: 6 }, tab: { flex: 1, alignItems: "center", gap: 2 }, icon: { color: "#718096", fontSize: 18 }, label: { color: "#718096", fontSize: 12 }, selected: { color: "#365FE8", fontWeight: "700" } });
