import { api } from "./api";

export type Stage2SearchSort = "relevance" | "recent";
export type Stage2SenderType = "user" | "agent";
export type Stage2SearchParams = {
  q?: string;
  channelId?: string;
  senderId?: string;
  senderType?: Stage2SenderType;
  mentionTarget?: "self";
  after?: string;
  before?: string;
  sort?: Stage2SearchSort;
  limit?: number;
  offset?: number;
};

export type SearchResult = {
  id: string;
  seq: number;
  channelId: string;
  threadId: string | null;
  parentMessageId: string | null;
  parentChannelId: string;
  parentChannelName: string;
  parentChannelType: string;
  senderId: string;
  senderType: string;
  senderName: string;
  channelName: string;
  channelType: string;
  content: string;
  snippet: string;
  createdAt: string;
};

export type SearchResponse = { results: SearchResult[]; hasMore: boolean };

export type SavedMessage = {
  messageId: string;
  channelId: string;
  channelName: string;
  channelType: string;
  content: string;
  senderType: string;
  senderId: string;
  senderName: string | null;
  createdAt: string;
  savedAt: string;
  parentChannelId: string | null;
  parentChannelName: string | null;
  parentMessageId: string | null;
  parentMessagePreview: string | null;
  replyCount: number;
};
export type SavedResponse = { saved: SavedMessage[]; hasMore: boolean; total: number; globalTotal: number };
export type SavedParams = { channelId?: string; q?: string; sort?: "asc" | "desc"; limit?: number; offset?: number };

export type ActivityFilter = "all" | "unread" | "mentions";
export type ActivityRow = {
  rowId: string;
  rowVersion?: string;
  latestActivitySeq?: string;
  type: "channel" | "dm" | "thread" | string;
  lastActivityAt: string;
  unreadCount: number;
  hasMention: boolean;
  maxReadSeq?: string;
  readStateVersion?: string;
  channelId?: string;
  channelName?: string;
  channelKind?: string;
  lastMessageId?: string;
  lastMessagePreview?: string;
  lastMessageSenderName?: string | null;
  threadChannelId?: string;
  parentMessageId?: string;
  parentChannelId?: string;
  parentChannelName?: string;
  parentChannelKind?: string;
  parentMessagePreview?: string;
  latestActivityMessageId?: string;
  latestActivityPreview?: string;
  latestActivitySenderName?: string | null;
  firstUnreadMessageId?: string | null;
  firstMentionMessageId?: string | null;
};

/** The legacy V1 page row returned by GET /api/channels/inbox. */
export type ActivityInboxRow = {
  kind: "channel" | "dm" | "thread";
  channelId?: string;
  channelName?: string;
  channelType?: string;
  lastMessageId?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastMessageSenderType?: string;
  lastMessageSenderId?: string;
  lastMessageSenderName?: string | null;
  threadChannelId?: string;
  parentMessageId?: string;
  parentChannelId?: string;
  parentChannelName?: string;
  parentChannelType?: string;
  parentMessagePreview?: string;
  latestActivityMessageId?: string;
  latestActivityPreview?: string;
  latestActivitySenderName?: string | null;
  lastActivityAt?: string;
  unreadCount: number;
  hasMention: boolean;
  firstUnreadMessageId?: string | null;
  firstMentionMessageId?: string | null;
};
export type ActivityWindow = {
  rows: ActivityRow[];
  tombstones: Array<{ rowId: string; rowVersion: string; reason: string }>;
  nextCursor: string | null;
  hasMore: boolean;
  complete: boolean;
  totalCount: number;
  totalUnreadCount: number;
};
export type ActivitySnapshot = {
  type: "snapshot";
  requestId: string;
  scope: { serverId: string; principalId: string; filter: ActivityFilter; windowId: string };
  epoch: string;
  watermark: string;
  activityVersion: string;
  window: ActivityWindow;
};
export type ActivityDifference = {
  type: "difference";
  requestId: string;
  scope: { serverId: string; principalId: string; filter: ActivityFilter; windowId: string };
  epoch: string;
  fromSeq: string;
  toSeq: string;
  activityVersion: string;
  rows: ActivityRow[];
  tombstones: ActivityWindow["tombstones"];
  nextCursor: string | null;
  hasMore: boolean;
  complete: boolean;
  totalCount: number;
  totalUnreadCount: number;
  nextFromSeq: string | null;
};
export type ActivitySnapshotParams = { serverId: string; filter?: ActivityFilter; requestId?: string; windowId?: "main" };

function randomRequestId(prefix: string): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject && "randomUUID" in cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return `${prefix}-${cryptoObject.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function queryString(values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") query.set(key, String(value));
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function formatStage2Date(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "时间未知";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "时间未知";
}

/** GET /api/messages/search — Web-compatible search contract. */
export function searchMessages(serverId: string, params: Stage2SearchParams = {}): Promise<SearchResponse> {
  const q = params.q?.trim();
  return api<SearchResponse>(`/api/messages/search${queryString({
    q: q || undefined,
    channelId: params.channelId,
    senderId: params.senderId,
    senderType: params.senderType,
    mentionTarget: params.mentionTarget,
    after: params.after,
    before: params.before,
    sort: params.sort,
    limit: params.limit,
    offset: params.offset,
  })}`, {}, serverId);
}

/** GET /api/channels/inbox — the deployed Activity page contract. */
export function getActivityInbox(serverId: string, params: { filter?: ActivityFilter; q?: string; limit?: number; offset?: number; sort?: "asc" | "desc" } = {}) {
  return api<{ items: ActivityInboxRow[]; hasMore: boolean; totalCount: number; totalUnreadCount: number; activeUnreadCount: number; groups: Array<Record<string, unknown>> }>(`/api/channels/inbox${queryString({ filter: params.filter ?? "all", q: params.q?.trim() || undefined, limit: params.limit, offset: params.offset, sort: params.sort })}`, {}, serverId);
}

/** GET /api/channels/activity/snapshot — exact Activity sync contract for future live repair. */
export function getActivitySnapshot(serverId: string, params: ActivitySnapshotParams): Promise<ActivitySnapshot> {
  const requestId = params.requestId ?? randomRequestId("mobile-activity-snapshot");
  return api<ActivitySnapshot>(`/api/channels/activity/snapshot${queryString({ requestId, filter: params.filter ?? "all", windowId: params.windowId ?? "main" })}`, {}, serverId);
}

export function getActivityDifference(serverId: string, args: { epoch: string; afterWatermark: string; filter?: ActivityFilter; requestId?: string; windowId?: "main" }): Promise<ActivityDifference> {
  const requestId = args.requestId ?? randomRequestId("mobile-activity-difference");
  return api<ActivityDifference>(`/api/channels/activity/difference${queryString({ requestId, filter: args.filter ?? "all", epoch: args.epoch, afterWatermark: args.afterWatermark, windowId: args.windowId ?? "main" })}`, {}, serverId);
}

/** GET /api/channels/saved — saved messages with server-side filter-before-pagination. */
export function getSavedMessages(serverId: string, params: SavedParams = {}): Promise<SavedResponse> {
  return api<SavedResponse>(`/api/channels/saved${queryString({ channelId: params.channelId, q: params.q?.trim() || undefined, sort: params.sort, limit: params.limit, offset: params.offset })}`, {}, serverId);
}

export function saveMessage(serverId: string, messageId: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/api/channels/saved", { method: "POST", body: JSON.stringify({ messageId }) }, serverId);
}

export function unsaveMessage(serverId: string, messageId: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/channels/saved/${encodeURIComponent(messageId)}`, { method: "DELETE" }, serverId);
}

export function checkSavedMessages(serverId: string, messageIds: string[]): Promise<{ savedIds: string[] }> {
  return api<{ savedIds: string[] }>("/api/channels/saved/check", { method: "POST", body: JSON.stringify({ messageIds }) }, serverId);
}
