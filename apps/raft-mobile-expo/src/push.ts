import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "./api";
import { APP_ENV } from "./config";
import { getInstallationId } from "./session";

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
  const installationId = await getInstallationId();
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier ?? "com.twitterisgood.raft.mobile";
  await api("/api/push/registrations", {
    method: "POST",
    body: JSON.stringify({
      provider: "apns",
      env: APP_ENV === "production" ? "production" : "sandbox",
      installationId,
      deviceToken,
      topic: bundleId,
      appVersion: Constants.expoConfig?.version ?? "0.1.0",
    }),
  }, serverId);
  return true;
}

export async function unregisterForPush(serverId: string): Promise<void> {
  const installationId = await getInstallationId();
  await api(`/api/push/registrations/${encodeURIComponent(installationId)}`, {
    method: "DELETE",
  }, serverId);
}

let consumedLastResponseId: string | null = null;
export function subscribeToNotificationTap(onTap: (data: Record<string, unknown>) => void) {
  let cancelled = false;
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    const responseId = response?.notification.request.identifier;
    if (responseId && responseId === consumedLastResponseId) return;
    if (responseId) consumedLastResponseId = responseId;
    const data = response?.notification.request.content.data;
    if (!cancelled && data && typeof data === "object") onTap(data as Record<string, unknown>);
  });
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const responseId = response.notification.request.identifier;
    if (responseId && responseId === consumedLastResponseId) return;
    if (responseId) consumedLastResponseId = responseId;
    const data = response.notification.request.content.data;
    if (data && typeof data === "object") onTap(data as Record<string, unknown>);
  });
  return () => { cancelled = true; subscription.remove(); };
}
