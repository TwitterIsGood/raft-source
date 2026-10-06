import { api } from "./api";
import { normalizeServerNotificationSettings, type ServerNotificationSettings, type ServerPushMode } from "./settingsModel";

export type MobileUser = {
  id: string;
  email: string;
  name: string;
  displayName: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
};

export type { ServerNotificationSettings, ServerPushMode } from "./settingsModel";

export async function getCurrentUser(): Promise<MobileUser> {
  return api<MobileUser>("/api/auth/me");
}

export async function updateCurrentUser(fields: { displayName?: string; currentPassword?: string; newPassword?: string }): Promise<MobileUser> {
  return api<MobileUser>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

export async function getServerNotificationSettings(serverId: string): Promise<ServerNotificationSettings> {
  const value = await api<Partial<ServerNotificationSettings>>(`/api/servers/${encodeURIComponent(serverId)}/notification-settings`, {}, serverId);
  return normalizeServerNotificationSettings(value);
}

export async function updateServerNotificationSettings(serverId: string, mode: ServerPushMode): Promise<ServerNotificationSettings> {
  const value = await api<Partial<ServerNotificationSettings>>(`/api/servers/${encodeURIComponent(serverId)}/notification-settings`, {
    method: "PATCH",
    body: JSON.stringify({ serverPushMode: mode }),
  }, serverId);
  return normalizeServerNotificationSettings(value);
}
