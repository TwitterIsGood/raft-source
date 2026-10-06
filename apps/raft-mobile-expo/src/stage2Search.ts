export function isCurrentSearchGeneration(current: number, response: number): boolean {
  return current === response;
}

export function reconcileSavedIds(
  current: Record<string, boolean>,
  ids: readonly string[],
  savedIds: readonly string[],
  mutationAtRequest: ReadonlyMap<string, number>,
  mutationNow: ReadonlyMap<string, number>,
): Record<string, boolean> {
  const saved = new Set(savedIds);
  const next = { ...current };
  for (const id of ids) {
    if ((mutationNow.get(id) ?? 0) === (mutationAtRequest.get(id) ?? 0)) next[id] = saved.has(id);
  }
  return next;
}
