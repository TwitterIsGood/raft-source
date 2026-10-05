export type MessageScope = { serverId: string; channelId: string };

export function isCurrentScope(expected: MessageScope, current: MessageScope | null): boolean {
  return current?.serverId === expected.serverId && current.channelId === expected.channelId;
}

export function completedCursor(previous: number, currentSeq: number, hasMore: boolean): number {
  return hasMore ? previous : Math.max(previous, Number.isFinite(currentSeq) ? currentSeq : previous);
}

export function sendableDraft(value: string): string {
  return value.trim();
}

export class NotificationResponseDeduper {
  private lastId: string | null = null;

  accept(id: string | null | undefined): boolean {
    if (!id) return true;
    if (id === this.lastId) return false;
    this.lastId = id;
    return true;
  }
}
