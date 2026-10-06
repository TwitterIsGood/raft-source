import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { api } from "./api";
import { PUSH_ENV } from "./config";
import { getInstallationId } from "./session";
import { NotificationResponseDeduper } from "./behavior";
import {
  clearPushRegistrationMarker,
  encodePushRegistrationMarker,
  resolveRuntimePushState,
  type PushMarkerIdentity,
  type RuntimePushState,
} from "./pushMarker";

// A SecureStore marker survives logout/restart and only proves that a
// registration happened in the past. "enabled" requires a fresh registration
// in this process; otherwise the UI stays conservative and reports unknown.
let runtimePushState: RuntimePushState = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

function tokenString(data: unknown): string | null {
  if (typeof data === "string") return data.replace(/[<>\s]/g, "").toLowerCase();
  return null;
}

export async function registerForPush(serverId: string): Promise<boolean> {
  if (!Device.isDevice) return false;
  const permissions = await Notifications.getPermissionsAsync();
  let status = permissions.status;
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return false;

  const deviceToken = tokenString((await Notifications.getDevicePushTokenAsync()).data);
  if (!deviceToken) return false;
  const [installationId, user] = await Promise.all([
    getInstallationId(),
    api<{ id: string }>("/api/auth/me"),
  ]);
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier ?? "com.twitterisgood.raft.mobile";
  await api("/api/push/registrations", {
    method: "POST",
    body: JSON.stringify({
      provider: "apns",
      env: PUSH_ENV,
      installationId,
      deviceToken,
      topic: bundleId,
      appVersion: Constants.expoConfig?.version ?? "0.1.0",
    }),
  }, serverId);
  try {
    await SecureStore.setItemAsync(
      registrationMarkerKey(serverId),
      encodePushRegistrationMarker({ version: 1, status: "registered", serverId, userId: user.id, installationId }),
    );
  } catch { /* registration succeeded; state will be unknown after restart */ }
  runtimePushState = { identity: { serverId, userId: user.id, installationId }, status: "enabled" };
  return true;
}

export async function unregisterForPush(serverId: string): Promise<"deleted" | "revoked" | "unknown"> {
  const [installationId, user] = await Promise.all([
    getInstallationId(),
    api<{ id: string }>("/api/auth/me"),
  ]);
  await api(`/api/push/registrations/${encodeURIComponent(installationId)}`, {
    method: "DELETE",
  }, serverId);
  const result = await clearPushRegistrationMarker(SecureStore, registrationMarkerKey(serverId), { serverId, userId: user.id, installationId });
  runtimePushState = result === "unknown"
    ? null
    : { identity: { serverId, userId: user.id, installationId }, status: "disabled" };
  return result;
}

const responseDeduper = new NotificationResponseDeduper();

export type PushRegistrationState = "unknown" | "enabled" | "unavailable" | "disabled" | "error";

function registrationMarkerKey(serverId: string): string {
  return `raft.push.registration.${serverId}`;
}

/** Read local permission and registration evidence without assuming a default. */
export async function getPushRegistrationState(serverId: string): Promise<PushRegistrationState> {
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status === "denied") return "unavailable";
    if (!Device.isDevice) return "unavailable";
    const [installationId, user] = await Promise.all([
      getInstallationId(),
      api<{ id: string }>("/api/auth/me"),
    ]);
    const identity: PushMarkerIdentity = { serverId, userId: user.id, installationId };
    const resolved = resolveRuntimePushState(runtimePushState, identity, permission.status === "granted", Device.isDevice);
    if (resolved !== "unavailable" && resolved !== "unknown") return resolved;
    if (resolved === "unavailable") return "unknown";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function subscribeToNotificationTap(onTap: (data: Record<string, unknown>) => void) {
  let cancelled = false;
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    const responseId = response?.notification.request.identifier;
    if (!responseDeduper.accept(responseId)) return;
    const data = response?.notification.request.content.data;
    if (!cancelled && data && typeof data === "object") onTap(data as Record<string, unknown>);
  });
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const responseId = response.notification.request.identifier;
    if (!responseDeduper.accept(responseId)) return;
    const data = response.notification.request.content.data;
    if (data && typeof data === "object") onTap(data as Record<string, unknown>);
  });
  return () => { cancelled = true; subscription.remove(); };
}
