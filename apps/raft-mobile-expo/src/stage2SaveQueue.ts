/**
 * Serialize save/unsave requests for one message while allowing different
 * messages to update independently. A failed operation does not block the
 * next queued intent.
 */
export function enqueueMessageMutation<T>(
  tails: Map<string, Promise<unknown>>,
  messageId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(messageId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  tails.set(messageId, current);
  void current.then(
    () => { if (tails.get(messageId) === current) tails.delete(messageId); },
    () => { if (tails.get(messageId) === current) tails.delete(messageId); },
  );
  return current;
}
