export function formatStage2Date(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "时间未知";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "时间未知";
}
