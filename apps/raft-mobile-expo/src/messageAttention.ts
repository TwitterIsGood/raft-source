export type MessageAttentionState = {
  isAtLatest: boolean;
  pendingMessageIds: readonly string[];
};

export function createMessageAttentionState(): MessageAttentionState {
  return { isAtLatest: true, pendingMessageIds: [] };
}

/**
 * In an inverted list offset 0 is the latest edge. Moving there acknowledges
 * every pending message; moving away keeps the existing notification count.
 */
export function setMessageLatestState(state: MessageAttentionState, isAtLatest: boolean): MessageAttentionState {
  if (isAtLatest) {
    if (state.isAtLatest && state.pendingMessageIds.length === 0) return state;
    return { isAtLatest: true, pendingMessageIds: [] };
  }
  if (!state.isAtLatest) return state;
  return { isAtLatest: false, pendingMessageIds: state.pendingMessageIds };
}

/**
 * Record only a message that extends the newest edge of the current window.
 * Historical pages and duplicate socket/sync deliveries are ignored.
 */
export function noteNewMessage(state: MessageAttentionState, messageId: string, isNewerThanWindow: boolean): MessageAttentionState {
  if (!isNewerThanWindow || state.isAtLatest || state.pendingMessageIds.includes(messageId)) return state;
  return { isAtLatest: false, pendingMessageIds: [...state.pendingMessageIds, messageId] };
}

export function clearMessageAttention(): MessageAttentionState {
  return createMessageAttentionState();
}

export function messageAttentionCount(state: MessageAttentionState): number {
  return state.pendingMessageIds.length;
}
