/** Convert a wire timestamp to a stable value for message rendering. */
export function normalizeMessageCreatedAt(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

/** Format a message timestamp without exposing the platform's Invalid Date text. */
export function formatMessageTime(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "时间未知";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "时间未知";
}
