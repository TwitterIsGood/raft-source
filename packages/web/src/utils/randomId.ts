/**
 * `crypto.randomUUID` is secure-context-only: on a plain-HTTP origin there is
 * no `crypto.randomUUID` at all, so a bare call throws `TypeError` inside
 * whatever handler made it — before the handler's own state updates run, which
 * makes the feature look like it did nothing (the composer's attachment picker
 * dropped every selection this way). `crypto.getRandomValues` carries no such
 * restriction, so assemble the UUIDv4 by hand when `randomUUID` is missing.
 */
export function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
