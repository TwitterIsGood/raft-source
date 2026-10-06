/**
 * Pure mention-authoring helpers for the mobile composer.
 *
 * The picker only creates identity-backed mentions for users and agents. The
 * server still resolves ordinary free-text `@handles`; this module deliberately
 * does not try to turn every `@word` in a draft into a structured payload.
 * Structured payloads mirror the server's `StructuredMentionInput` contract:
 * `{ type: "user" | "agent", id: UUID, name: string }`.
 */

export type MentionIdentityType = "user" | "agent";
export type MentionResourceType = MentionIdentityType | "computer" | "app";

export interface MentionCandidate {
  id: string;
  name: string;
  displayName?: string | null;
  type: MentionResourceType;
  avatarUrl?: string | null;
  serverId?: string | null;
  serverName?: string | null;
  serverSlug?: string | null;
  description?: string | null;
}

export interface StructuredMention {
  type: MentionIdentityType;
  id: string;
  name: string;
}

/** Compatibility name used by the web message model. */
export type MessageMention = StructuredMention;

export interface MentionCandidateGroups {
  inChannel: MentionCandidate[];
  notInChannel: MentionCandidate[];
  computers: MentionCandidate[];
  apps: MentionCandidate[];
  flat: MentionCandidate[];
}

export interface MentionSearchField {
  raw: string;
  priority: number;
}

export interface MentionCandidateSearchEntry {
  index: number;
  suggestion: MentionCandidate;
  fields: MentionSearchField[];
}

export interface MentionTrigger {
  /** Index of the `@` that starts the active token. */
  start: number;
  /** Cursor position (exclusive) at which the query was inspected. */
  end: number;
  /** Text after `@`, without the trigger character. */
  query: string;
}

export interface MentionInsertion {
  content: string;
  cursor: number;
  mention: StructuredMention | null;
}

/** Private and joint channels scope the picker to their effective members. */
export function isMemberScopedMentionChannel(channel: { type?: string | null } | null | undefined): boolean {
  return channel?.type === "private" || channel?.type === "joint";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE_RE = /^[\p{L}\p{N}_-]+$/u;
const HANDLE_CHAR_RE = /^[\p{L}\p{N}_-]$/u;
const MAX_SEARCH_RESULTS = 30;

function isHandleChar(value: string): boolean {
  return value.length > 0 && HANDLE_CHAR_RE.test(value);
}

function normalizedQuery(query: string): string {
  return query.trim().replace(/^@/, "").toLocaleLowerCase();
}

function candidateKey(candidate: Pick<MentionCandidate, "type" | "id">): string {
  return `${candidate.type}:${candidate.id}`;
}

function dedupeCandidates(candidates: MentionCandidate[]): MentionCandidate[] {
  const seen = new Set<string>();
  const result: MentionCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.id !== "string" || typeof candidate.name !== "string") continue;
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function candidateFields(candidate: MentionCandidate): string[] {
  return [candidate.name, candidate.displayName ?? "", candidate.description ?? "", getMentionCandidateServerLabel(candidate) ?? ""]
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean);
}

/** Search-field projection shared with the web composer shape. */
export function createMentionCandidateSearchEntries(candidates: MentionCandidate[]): MentionCandidateSearchEntry[] {
  return candidates.map((candidate, index) => ({
    index,
    suggestion: candidate,
    fields: [
      { raw: candidate.name, priority: 0 },
      { raw: candidate.displayName ?? "", priority: 1 },
      { raw: candidate.description ?? "", priority: 3 },
      { raw: getMentionCandidateServerLabel(candidate) ?? "", priority: 4 },
    ],
  }));
}

function candidateScore(candidate: MentionCandidate, query: string): [number, number, number] | null {
  if (!query) return [0, 0, 0];
  const fields = candidateFields(candidate);
  let best: [number, number, number] | null = null;
  fields.forEach((field, fieldIndex) => {
    const position = field.indexOf(query);
    if (position < 0) return;
    const rank = field === query ? 0 : field.startsWith(query) ? 1 : 2;
    const score: [number, number, number] = [rank, fieldIndex, position];
    if (!best || score[0] < best[0] || (score[0] === best[0] && (score[1] < best[1] || (score[1] === best[1] && score[2] < best[2])))) {
      best = score;
    }
  });
  return best;
}

/** Return a compact description suitable for a candidate row. */
export function getMentionCandidateDescription(candidate: MentionCandidate): string | null {
  const description = candidate.description?.trim().replace(/\s+/g, " ");
  return description || null;
}

/** Return the remote server label used to disambiguate a candidate. */
export function getMentionCandidateServerLabel(candidate: MentionCandidate): string | null {
  const value = candidate.serverName?.trim() || candidate.serverSlug?.trim();
  return value || null;
}

/**
 * Search candidates using the same stable exact/prefix/substring ordering as
 * the web composer. Blank queries retain caller order; duplicate identities are
 * collapsed before searching.
 */
export function rankMentionCandidates(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const unique = dedupeCandidates(candidates);
  const cleanQuery = normalizedQuery(query);
  if (!cleanQuery) return unique.slice(0, MAX_SEARCH_RESULTS);
  return unique
    .map((candidate, index) => ({ candidate, index, score: candidateScore(candidate, cleanQuery) }))
    .filter((row): row is { candidate: MentionCandidate; index: number; score: [number, number, number] } => row.score !== null)
    .sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2] - b.score[2] || a.index - b.index)
    .slice(0, MAX_SEARCH_RESULTS)
    .map((row) => row.candidate);
}

function threadRecencyRanks(threadSenderIds: readonly string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  let next = 0;
  for (let index = threadSenderIds.length - 1; index >= 0; index -= 1) {
    const id = threadSenderIds[index];
    if (id && !ranks.has(id)) ranks.set(id, next++);
  }
  return ranks;
}

function prioritizeThreadParticipants(candidates: MentionCandidate[], threadSenderIds: readonly string[]): MentionCandidate[] {
  const originalOrder = new Map(candidates.map((candidate, index) => [candidateKey(candidate), index]));
  const recency = threadRecencyRanks(threadSenderIds);
  return [...candidates].sort((a, b) => {
    const aRank = recency.get(a.id) ?? Number.POSITIVE_INFINITY;
    const bRank = recency.get(b.id) ?? Number.POSITIVE_INFINITY;
    return aRank - bRank || (originalOrder.get(candidateKey(a)) ?? 0) - (originalOrder.get(candidateKey(b)) ?? 0);
  });
}

export interface BuildMentionCandidateGroupsOptions {
  candidates: MentionCandidate[];
  query?: string;
  channelMemberIds?: ReadonlySet<string>;
  /** Sender ids in display order (oldest to newest). */
  threadSenderIds?: readonly string[];
  /** Web-compatible alternative to `threadSenderIds`. */
  threadMessages?: readonly { senderId?: string | null }[];
  prioritizeThreadParticipants?: boolean;
}

/** Group people, computers and apps while retaining the web composer's order. */
export function buildMentionCandidateGroups(options: BuildMentionCandidateGroupsOptions): MentionCandidateGroups {
  const ranked = rankMentionCandidates(options.candidates, options.query ?? "");
  return buildMentionCandidateGroupsFromRankedCandidates({
    rankedCandidates: ranked,
    channelMemberIds: options.channelMemberIds,
    threadSenderIds: options.threadSenderIds,
    threadMessages: options.threadMessages,
    prioritizeThreadParticipants: options.prioritizeThreadParticipants,
  });
}

export interface BuildMentionCandidateGroupsFromRankedOptions {
  rankedCandidates: MentionCandidate[];
  channelMemberIds?: ReadonlySet<string>;
  threadSenderIds?: readonly string[];
  threadMessages?: readonly { senderId?: string | null }[];
  prioritizeThreadParticipants?: boolean;
}

/** Group an already-ranked list without changing search order before grouping. */
export function buildMentionCandidateGroupsFromRankedCandidates(options: BuildMentionCandidateGroupsFromRankedOptions): MentionCandidateGroups {
  const ranked = dedupeCandidates(options.rankedCandidates);
  const channelMemberIds = options.channelMemberIds ?? new Set<string>();
  const people = ranked.filter((candidate) => candidate.type === "user" || candidate.type === "agent");
  const computers = ranked.filter((candidate) => candidate.type === "computer");
  const apps = ranked.filter((candidate) => candidate.type === "app");
  let inChannel = people.filter((candidate) => channelMemberIds.has(candidate.id));
  let notInChannel = people.filter((candidate) => !channelMemberIds.has(candidate.id));
  if (options.prioritizeThreadParticipants) {
    const senderIds = options.threadSenderIds
      ?? options.threadMessages?.map((message) => message.senderId ?? "")
      ?? [];
    inChannel = prioritizeThreadParticipants(inChannel, senderIds);
    notInChannel = prioritizeThreadParticipants(notInChannel, senderIds);
  }
  return { inChannel, notInChannel, computers, apps, flat: [...inChannel, ...notInChannel, ...computers, ...apps] };
}

/** Locate the active `@handle` immediately before a text cursor. */
export function findMentionTrigger(content: string, cursor: number): MentionTrigger | null {
  const end = Math.max(0, Math.min(cursor, content.length));
  let queryStart = end;
  while (queryStart > 0 && isHandleChar(content[queryStart - 1] ?? "")) queryStart -= 1;
  if (queryStart === 0 || content[queryStart - 1] !== "@") return null;
  // Keep email/package-like text inert, matching the server's left boundary.
  if (queryStart > 1 && isHandleChar(content[queryStart - 2] ?? "")) return null;
  return { start: queryStart - 1, end, query: content.slice(queryStart, end) };
}

/** Insert a selected handle at the active trigger, preserving the cursor. */
export function insertMentionAtCursor(content: string, cursor: number, candidate: MentionCandidate | string): MentionInsertion {
  const name = typeof candidate === "string" ? candidate.trim() : candidate.name.trim();
  if (!name || !HANDLE_RE.test(name)) return { content, cursor: Math.max(0, Math.min(cursor, content.length)), mention: null };
  const normalizedCursor = Math.max(0, Math.min(cursor, content.length));
  const trigger = findMentionTrigger(content, normalizedCursor);
  const start = trigger?.start ?? normalizedCursor;
  const before = content.slice(0, start);
  const after = content.slice(normalizedCursor);
  // Match the web composer: a completed picker token always gets a trailing
  // separator so the next keystroke cannot become part of the handle.
  const insertion = `@${name} `;
  const next = `${before}${insertion}${after}`;
  const nextCursor = before.length + insertion.length;
  const mention = typeof candidate === "string" ? null : toStructuredMention(candidate);
  return { content: next, cursor: nextCursor, mention };
}

/** Convert a picker candidate to the server's structured mention shape. */
export function toStructuredMention(candidate: MentionCandidate): StructuredMention | null {
  if (candidate.type !== "user" && candidate.type !== "agent") return null;
  const name = candidate.name.trim();
  if (!UUID_RE.test(candidate.id) || !name || name.length > 128) return null;
  return { type: candidate.type, id: candidate.id, name };
}

/** Validate and normalize an unknown wire payload using the server contract. */
export function normalizeStructuredMentions(value: unknown): StructuredMention[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const result: StructuredMention[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    if ((raw.type !== "user" && raw.type !== "agent") || typeof raw.id !== "string" || !UUID_RE.test(raw.id)) return null;
    if (typeof raw.name !== "string") return null;
    const name = raw.name.trim();
    if (!name || name.length > 128) return null;
    const mention: StructuredMention = { type: raw.type, id: raw.id, name };
    const key = `${mention.type}:${mention.id}:${mention.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(mention);
    }
  }
  return result;
}

/** Wire-compatible parser result for callers that mirror the server route. */
export function parseStructuredMentions(value: unknown): StructuredMention[] | "invalid" {
  return normalizeStructuredMentions(value) ?? "invalid";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withoutMarkdownCode(source: string): string {
  let result = "";
  let inline = false;
  let fence = false;
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("```", index)) {
      fence = !fence;
      result += "   ";
      index += 2;
      continue;
    }
    const char = source[index] ?? "";
    if (!fence && char === "`") {
      inline = !inline;
      result += " ";
      continue;
    }
    result += fence || inline ? (char === "\n" ? "\n" : " ") : char;
  }
  return result;
}

function removeResourceMentionLabels(source: string): string {
  // Computer/app refs use a human-facing @label but are not user mentions.
  return source.replace(/\[((?:\\.|[^\]\\])*)\]\(<(?:computer|app):[^<>\n]+>\)/giu, "");
}

/** Match the exact selected handle outside Markdown code/resource labels. */
export function structuredMentionStillAppears(content: string, name: string): boolean {
  const handle = name.trim();
  if (!HANDLE_RE.test(handle)) return false;
  const visible = withoutMarkdownCode(removeResourceMentionLabels(content))
    .replace(/\\<@[\p{L}\p{N}_-]+>/gu, "");
  return new RegExp(`@${escapeRegExp(handle)}(?![\\p{L}\\p{N}_-])`, "u").test(visible);
}

/**
 * Build the payload to pass to `/api/messages`. Stale picker selections are
 * removed when the user edits the token away; free-text mentions remain for
 * server-side handle resolution.
 */
export function buildStructuredMentions(content: string, selected: readonly (StructuredMention | MentionCandidate)[]): StructuredMention[] {
  const visible = selected
    .filter((item) => structuredMentionStillAppears(content, item.name))
    .filter((item): item is StructuredMention => item.type === "user" || item.type === "agent")
    .map((item) => ({ type: item.type, id: item.id, name: item.name }));
  return normalizeStructuredMentions(visible) ?? [];
}
