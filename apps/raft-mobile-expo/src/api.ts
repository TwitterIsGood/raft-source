import { API_BASE_URL } from "./config";
import { clearSession, getSessionGeneration, readSession, saveSession } from "./session";

let refreshInFlight: Promise<string | null> | null = null;

async function raw<T>(path: string, init: RequestInit = {}, token?: string, serverId?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body instanceof FormData) headers.delete("Content-Type");
  else headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (serverId) headers.set("X-Server-Id", serverId);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(body || `Request failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const generation = getSessionGeneration();
    const { refreshToken } = await readSession();
    if (!refreshToken) return null;
    try {
      const result = await raw<{ accessToken: string; refreshToken: string }>("/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
      if (getSessionGeneration() !== generation) return null;
      await saveSession(result.accessToken, result.refreshToken);
      return result.accessToken;
    } catch (error) {
      const status = (error as { status?: number }).status;
      // A network/5xx failure must keep the local session so the next request
      // can retry. Only an explicit credential rejection invalidates it.
      if (status === 401 || status === 403) await clearSession();
      if (status === 401 || status === 403) return null;
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T>(path: string, init: RequestInit = {}, serverId?: string): Promise<T> {
  const { accessToken } = await readSession();
  try {
    return await raw<T>(path, init, accessToken ?? undefined, serverId);
  } catch (error) {
    if ((error as { status?: number }).status !== 401 || path.startsWith("/api/auth/")) throw error;
    const token = await refreshAccessToken();
    if (!token) throw error;
    return raw<T>(path, init, token, serverId);
  }
}

export async function apiMultipart<T>(path: string, body: FormData, serverId?: string): Promise<T> {
  return api<T>(path, { method: "POST", body }, serverId);
}

export async function login(email: string, password: string) {
  const result = await raw<{ accessToken: string; refreshToken: string; user: unknown }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await saveSession(result.accessToken, result.refreshToken);
  return result;
}

export async function register(email: string, password: string) {
  const result = await raw<{ accessToken: string; refreshToken: string; user: unknown }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      acceptTerms: true,
      termsVersion: "2026-05-12",
      privacyVersion: "2026-05-12",
      legalAcceptanceSource: "signup",
    }),
  });
  await saveSession(result.accessToken, result.refreshToken);
  return result;
}

export async function completeProfile(name: string, displayName?: string) {
  return api<{ id: string; name: string; displayName?: string | null; profileSetupCompletedAt?: string | null }>("/api/auth/me/complete-profile", {
    method: "POST",
    body: JSON.stringify({ name, displayName: displayName || name }),
  });
}

export async function forgotPassword(email: string) {
  return raw<{ ok: boolean; message: string }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function logoutRemote() {
  const { refreshToken } = await readSession();
  if (!refreshToken) return;
  await raw<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export async function getServers() { return api<ServerResponse[]>("/api/servers"); }
export async function getChannels(serverId: string) { return api<ChannelResponse[]>("/api/channels", {}, serverId); }
export async function getDMs(serverId: string) { return api<ChannelResponse[]>("/api/channels/dm", {}, serverId); }
export async function getChannel(serverId: string, channelId: string) { return api<ChannelResponse>(`/api/channels/${channelId}`, {}, serverId); }
export async function getChannelMembers(serverId: string, channelId: string) { return api<ChannelMembersResponse>(`/api/channels/${channelId}/members`, {}, serverId); }
export async function getMessages(serverId: string, channelId: string, before?: number) {
  const cursor = before ? `&before=${before}` : "";
  return api<{ messages: MessageResponse[]; historyLimited?: boolean }>(`/api/messages/channel/${channelId}?limit=50${cursor}`, {}, serverId);
}
export async function getMessageContext(serverId: string, channelId: string, messageId: string) {
  return api<{
    messages: MessageResponse[];
    targetMessageId?: string;
    hasOlder?: boolean;
    hasNewer?: boolean;
    historyLimited?: boolean;
  }>(`/api/messages/context/${encodeURIComponent(messageId)}?channelId=${encodeURIComponent(channelId)}`, {}, serverId);
}
export async function getOrCreateThread(serverId: string, channelId: string, parentMessageId: string) {
  return api<{ threadChannelId: string }>(`/api/channels/${channelId}/threads`, { method: "POST", body: JSON.stringify({ parentMessageId }) }, serverId);
}
export async function sendMessage(serverId: string, channelId: string, content: string, options: { attachmentIds?: string[]; mentions?: StructuredMentionResponse[] } = {}) {
  return api<MessageResponse>("/api/messages", {
    method: "POST",
    body: JSON.stringify({ channelId, content, randomId: `ios-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...(options.attachmentIds?.length ? { attachmentIds: options.attachmentIds } : {}), ...(options.mentions?.length ? { mentions: options.mentions } : {}) }),
  }, serverId);
}

export type ServerResponse = { id: string; name: string; slug: string; avatarUrl?: string | null; role?: string };
export type ChannelResponse = { id: string; name?: string | null; type?: string; serverId: string; joined?: boolean; archivedAt?: string | null; peerName?: string; peerDisplayName?: string | null };
export type ChannelMemberResponse = { id: string; name?: string; displayName?: string | null; avatarUrl?: string | null; status?: string };
export type ChannelMembersResponse = { humans?: ChannelMemberResponse[]; agents?: ChannelMemberResponse[] };
export type StructuredMentionResponse = { type: "user" | "agent"; id: string; name: string };
export type MessageResponse = { id: string; seq?: number; channelId: string; senderType?: string; senderId?: string; senderName?: string; content: string; createdAt: string; updatedAt?: string; messageType?: string; attachmentIds?: string[]; attachments?: unknown[]; mentions?: StructuredMentionResponse[] };
