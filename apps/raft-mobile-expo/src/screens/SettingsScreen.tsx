import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { registerForPush, unregisterForPush } from "../push";
import { getCurrentUser, getServerNotificationSettings, updateCurrentUser, updateServerNotificationSettings, type MobileUser, type ServerNotificationSettings, type ServerPushMode } from "../settingsApi";

type Props = {
  serverId: string | null;
  onBack: () => void;
  onLogout: () => void;
};

const MODE_OPTIONS: ReadonlyArray<{ mode: ServerPushMode; title: string; description: string }> = [
  { mode: "all", title: "全部消息", description: "接收当前工作区的普通消息和提及。" },
  { mode: "mentions", title: "仅提及", description: "只接收提及你的消息。" },
  { mode: "none", title: "关闭通知", description: "不接收当前工作区的消息推送。" },
];

export function SettingsScreen({ serverId, onBack, onLogout }: Props) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [savedDisplayName, setSavedDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notificationSettings, setNotificationSettings] = useState<ServerNotificationSettings | null>(null);
  const [pushState, setPushState] = useState<"unknown" | "enabled" | "unavailable" | "disabled" | "error">("unknown");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextUser, nextPrefs] = await Promise.all([
        getCurrentUser(),
        serverId ? getServerNotificationSettings(serverId) : Promise.resolve(null),
      ]);
      setUser(nextUser);
      setDisplayName(nextUser.displayName ?? "");
      setSavedDisplayName(nextUser.displayName ?? "");
      setNotificationSettings(nextPrefs);
      setPushState("disabled");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { void load(); }, [load]);

  const saveProfile = async () => {
    const next = displayName.trim();
    if (!next || next === savedDisplayName) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const nextUser = await updateCurrentUser({ displayName: next });
      setUser(nextUser);
      setDisplayName(nextUser.displayName ?? next);
      setSavedDisplayName(nextUser.displayName ?? next);
      setMessage("账号资料已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const savePassword = async () => {
    if (!currentPassword || newPassword.length < 8 || newPassword !== confirmPassword) {
      setError(newPassword.length < 8 ? "新密码至少需要 8 个字符。" : "两次输入的新密码不一致。 ");
      return;
    }
    setBusy(true); setError(null); setMessage(null);
    try {
      await updateCurrentUser({ currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setMessage("密码已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const saveNotificationMode = async (mode: ServerPushMode) => {
    if (!serverId || !notificationSettings || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const next = await updateServerNotificationSettings(serverId, mode);
      setNotificationSettings(next);
      setMessage("通知设置已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const enablePush = async () => {
    if (!serverId || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const enabled = await registerForPush(serverId);
      setPushState(enabled ? "enabled" : "unavailable");
      setMessage(enabled ? "本机推送已注册。" : "当前设备无法注册 APNs；请在签名真机上允许通知。 ");
    } catch (cause) {
      setPushState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const disablePush = async () => {
    if (!serverId || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await unregisterForPush(serverId);
      setPushState("disabled");
      setMessage("本机推送已停用。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#365FE8" /></View>;

  return <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.titleRow}><Text style={styles.title}>设置</Text><Pressable accessibilityRole="button" accessibilityLabel="返回消息" onPress={onBack}><Text style={styles.link}>返回</Text></Pressable></View>
    {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
    {message ? <View style={styles.message}><Text style={styles.messageText}>{message}</Text></View> : null}

    <View style={styles.card} accessibilityLabel="账号设置">
      <Text style={styles.sectionTitle}>账号</Text>
      <Text style={styles.label}>邮箱</Text>
      <Text style={styles.value}>{user?.email || "—"}</Text>
      <Text style={styles.label}>用户名</Text>
      <Text style={styles.value}>@{user?.name || "—"}</Text>
      <Text style={styles.label}>显示名称</Text>
      <TextInput accessibilityLabel="显示名称" value={displayName} onChangeText={setDisplayName} style={styles.input} maxLength={120} />
      <Pressable accessibilityRole="button" accessibilityLabel="保存账号资料" disabled={busy || !displayName.trim() || displayName.trim() === savedDisplayName} onPress={() => void saveProfile()} style={[styles.primary, (busy || !displayName.trim() || displayName.trim() === savedDisplayName) && styles.disabled]}><Text style={styles.primaryText}>保存资料</Text></Pressable>
      <Text style={styles.label}>修改密码</Text>
      <TextInput accessibilityLabel="当前密码" value={currentPassword} onChangeText={setCurrentPassword} placeholder="当前密码" secureTextEntry style={styles.input} />
      <TextInput accessibilityLabel="新密码" value={newPassword} onChangeText={setNewPassword} placeholder="新密码（至少 8 个字符）" secureTextEntry style={styles.input} />
      <TextInput accessibilityLabel="确认新密码" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="再次输入新密码" secureTextEntry style={styles.input} />
      <Pressable accessibilityRole="button" accessibilityLabel="保存新密码" disabled={busy || !currentPassword || !newPassword || !confirmPassword} onPress={() => void savePassword()} style={[styles.secondary, (busy || !currentPassword || !newPassword || !confirmPassword) && styles.disabled]}><Text style={styles.secondaryText}>更新密码</Text></Pressable>
    </View>

    <View style={styles.card} accessibilityLabel="通知设置">
      <Text style={styles.sectionTitle}>通知</Text>
      <Text style={styles.description}>推送注册只会把本机 APNs token 交给当前隔离服务器；生产配置不会由此改变。</Text>
      {serverId && notificationSettings ? <>
        <Text style={styles.label}>当前工作区推送范围</Text>
        {MODE_OPTIONS.map((option) => <Pressable key={option.mode} accessibilityRole="radio" accessibilityState={{ selected: notificationSettings.serverPushMode === option.mode }} onPress={() => void saveNotificationMode(option.mode)} style={[styles.option, notificationSettings.serverPushMode === option.mode && styles.optionSelected]}><View style={styles.optionTitleRow}><Text style={styles.optionTitle}>{option.title}</Text><Text style={styles.radio}>{notificationSettings.serverPushMode === option.mode ? "●" : "○"}</Text></View><Text style={styles.description}>{option.description}</Text></Pressable>)}
        <Text style={styles.label}>本机 APNs</Text>
        <Text style={styles.value}>{pushState === "enabled" ? "已注册" : pushState === "unavailable" ? "当前设备不可用" : pushState === "error" ? "注册失败" : "未注册或未验证"}</Text>
        <View style={styles.actions}><Pressable accessibilityRole="button" accessibilityLabel="启用本机推送" disabled={busy} onPress={() => void enablePush()} style={[styles.secondary, busy && styles.disabled]}><Text style={styles.secondaryText}>启用本机推送</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="停用本机推送" disabled={busy} onPress={() => void disablePush()} style={[styles.secondary, busy && styles.disabled]}><Text style={styles.secondaryText}>停用</Text></Pressable></View>
      </> : <Text style={styles.description}>选择一个工作区后，可在这里调整消息推送范围。</Text>}
    </View>

    <View style={styles.card}><Text style={styles.sectionTitle}>会话</Text><Pressable accessibilityRole="button" accessibilityLabel="退出登录" onPress={onLogout} style={styles.danger}><Text style={styles.dangerText}>退出登录</Text></Pressable></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F6F8FB" }, content: { padding: 16, paddingBottom: 40, gap: 14 }, center: { flex: 1, alignItems: "center", justifyContent: "center" }, titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, title: { color: "#17212F", fontSize: 24, fontWeight: "700" }, link: { color: "#365FE8", fontWeight: "700" }, card: { borderWidth: 1, borderColor: "#E5EAF0", borderRadius: 12, backgroundColor: "#FFF", padding: 16, gap: 8 }, sectionTitle: { color: "#17212F", fontSize: 18, fontWeight: "700", marginBottom: 4 }, label: { color: "#718096", fontSize: 12, marginTop: 4 }, value: { color: "#17212F", fontSize: 15 }, input: { minHeight: 44, borderWidth: 1, borderColor: "#CBD5E0", borderRadius: 8, paddingHorizontal: 10, color: "#17212F", fontSize: 16 }, description: { color: "#718096", fontSize: 12, lineHeight: 18 }, primary: { minHeight: 44, borderRadius: 8, backgroundColor: "#365FE8", alignItems: "center", justifyContent: "center", marginTop: 4 }, primaryText: { color: "#FFF", fontWeight: "700" }, secondary: { minHeight: 42, borderWidth: 1, borderColor: "#365FE8", borderRadius: 8, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, secondaryText: { color: "#365FE8", fontWeight: "700" }, actions: { flexDirection: "row", gap: 8, marginTop: 4 }, option: { borderWidth: 1, borderColor: "#E5EAF0", borderRadius: 8, padding: 10, marginTop: 4 }, optionSelected: { borderColor: "#365FE8", backgroundColor: "#E8EEFF" }, optionTitleRow: { flexDirection: "row", justifyContent: "space-between" }, optionTitle: { color: "#17212F", fontWeight: "700" }, radio: { color: "#365FE8", fontSize: 18 }, error: { padding: 10, borderRadius: 8, backgroundColor: "#FEE2E2" }, errorText: { color: "#991B1B", fontSize: 13 }, message: { padding: 10, borderRadius: 8, backgroundColor: "#DCFCE7" }, messageText: { color: "#166534", fontSize: 13 }, danger: { minHeight: 44, borderWidth: 1, borderColor: "#B91C1C", borderRadius: 8, alignItems: "center", justifyContent: "center" }, dangerText: { color: "#B91C1C", fontWeight: "700" }, disabled: { opacity: 0.45 },
});
