import type { Message } from "./types";

const key = (serverId: string, channelId: string) => `${serverId}:${channelId}`;

export class MessageCache {
  private readonly buckets = new Map<string, Message[]>();
  private readonly cursors = new Map<string, number>();

  get(serverId: string, channelId: string): Message[] {
    return this.buckets.get(key(serverId, channelId)) ?? [];
  }

  merge(serverId: string, rows: Message[]): Map<string, Message[]> {
    const result = new Map<string, Message[]>();
    for (const row of rows) {
      const bucketKey = key(serverId, row.channelId);
      const current = result.get(row.channelId) ?? this.buckets.get(bucketKey) ?? [];
      const byId = new Map([...current, row].map((message) => [message.id, message]));
      const next = [...byId.values()].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
      result.set(row.channelId, next);
      this.buckets.set(bucketKey, next);
    }
    return result;
  }

  hasCursor(serverId: string): boolean { return this.cursors.has(serverId); }
  cursor(serverId: string): number { return this.cursors.get(serverId) ?? 0; }
  advance(serverId: string, seq: number): void {
    if (Number.isFinite(seq)) this.cursors.set(serverId, Math.max(this.cursor(serverId), seq));
  }
  clear(): void { this.buckets.clear(); this.cursors.clear(); }
}
