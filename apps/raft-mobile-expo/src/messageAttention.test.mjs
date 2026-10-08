import assert from "node:assert/strict";
import test from "node:test";
import { createMessageAttentionState, messageAttentionCount, noteNewMessage, setMessageLatestState } from "./messageAttention.ts";

test("history position counts each new message once", () => {
  let state = setMessageLatestState(createMessageAttentionState(), false);
  state = noteNewMessage(state, "m1", true);
  state = noteNewMessage(state, "m1", true);
  state = noteNewMessage(state, "m2", true);
  assert.equal(messageAttentionCount(state), 2);
  assert.equal(state.isAtLatest, false);
});

test("latest position follows new messages without a banner", () => {
  const state = noteNewMessage(createMessageAttentionState(), "m1", true);
  assert.equal(state.isAtLatest, true);
  assert.equal(messageAttentionCount(state), 0);
});

test("historical pages do not create a new-message notification", () => {
  let state = setMessageLatestState(createMessageAttentionState(), false);
  state = noteNewMessage(state, "old-page-row", false);
  assert.equal(messageAttentionCount(state), 0);
});

test("returning to latest clears the pending notification", () => {
  let state = setMessageLatestState(createMessageAttentionState(), false);
  state = noteNewMessage(state, "m1", true);
  state = setMessageLatestState(state, true);
  assert.deepEqual(state, { isAtLatest: true, pendingMessageIds: [] });
});
