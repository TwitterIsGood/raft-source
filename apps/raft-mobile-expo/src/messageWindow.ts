import type { Message } from "./types";

export function mergeMessageWindow(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map([...current, ...incoming].map((message) => [message.id, message]));
  return [...byId.values()].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
}

/** A sync/live row may extend the newest edge, but must not bypass history paging. */
export function mergeLiveMessage(current: Message[], incoming: Message): Message[] {
  if (current.length === 0) return [incoming];
  const oldest = Math.min(...current.map((message) => message.seq ?? Number.MAX_SAFE_INTEGER));
  if (!current.some((message) => message.id === incoming.id) && (incoming.seq ?? 0) < oldest) return current;
  return mergeMessageWindow(current, [incoming]);
}

/** The first page remains bounded even when server sync populated the cache first. */
export function firstMessageWindow(page: Message[], cache: Message[]): Message[] {
  if (page.length === 0) return [];
  const oldest = Math.min(...page.map((message) => message.seq ?? Number.MAX_SAFE_INTEGER));
  return mergeMessageWindow(page, cache.filter((message) => (message.seq ?? 0) >= oldest));
}
