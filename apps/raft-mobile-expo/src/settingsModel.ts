export type ServerPushMode = "all" | "mentions" | "none";

export type ServerNotificationSettings = {
  serverPushMuted: boolean;
  serverPushMentionsOnly: boolean;
  serverPushMode: ServerPushMode;
  prefsVersion: number;
};

export function normalizeServerNotificationSettings(value: Partial<ServerNotificationSettings>): ServerNotificationSettings {
  const mode = value.serverPushMode === "mentions" || value.serverPushMode === "none" ? value.serverPushMode : "all";
  const muted = mode === "none" || value.serverPushMuted === true;
  return {
    serverPushMuted: muted,
    serverPushMentionsOnly: mode === "mentions",
    serverPushMode: muted ? "none" : mode,
    prefsVersion: Number.isSafeInteger(value.prefsVersion) && (value.prefsVersion as number) >= 0 ? value.prefsVersion as number : 0,
  };
}
