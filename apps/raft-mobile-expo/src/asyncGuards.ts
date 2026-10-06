export type AsyncScope = {
  epoch: number;
  serverId: string;
  channelId: string;
  /** Optional navigation/composer operation id for repeated A→B→A scopes. */
  operation?: number;
};

export type ComposerSnapshot = {
  draft: string;
  attachmentIds: readonly string[];
};

export function isCurrentAsyncScope(expected: AsyncScope, current: AsyncScope | null): boolean {
  return current?.epoch === expected.epoch
    && current.serverId === expected.serverId
    && current.channelId === expected.channelId
    && (expected.operation === undefined || current.operation === expected.operation);
}

export function canClearComposerAfterSend(
  expected: AsyncScope,
  current: AsyncScope | null,
  beforeSend: ComposerSnapshot,
  now: ComposerSnapshot,
): boolean {
  if (!isCurrentAsyncScope(expected, current) || now.draft !== "") return false;
  if (beforeSend.attachmentIds.length !== now.attachmentIds.length) return false;
  return beforeSend.attachmentIds.every((id, index) => id === now.attachmentIds[index]);
}
