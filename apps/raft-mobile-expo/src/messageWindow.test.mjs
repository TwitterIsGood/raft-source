import test from "node:test";
import assert from "node:assert/strict";
import { firstMessageWindow, mergeLiveMessage, mergeMessageWindow } from "./messageWindow.ts";

const row = (seq) => ({ id: `${seq}`, seq, channelId: "channel", content: `${seq}`, createdAt: "2026-10-07T00:00:00Z" });

test("server sync cannot expose old cached rows before history pagination", () => {
  const page = [row(80), row(79), row(78)];
  const cached = [row(81), ...page, row(77), row(76)];
  assert.deepEqual(firstMessageWindow(page, cached).map((message) => message.seq), [81, 80, 79, 78]);
  assert.deepEqual(mergeLiveMessage(page, row(77)).map((message) => message.seq), [80, 79, 78]);
  assert.deepEqual(mergeLiveMessage(page, row(81)).map((message) => message.seq), [81, 80, 79, 78]);
  assert.deepEqual(mergeLiveMessage([], row(81)), []);
});

test("history page extends the old edge and deduplicates overlap", () => {
  assert.deepEqual(mergeMessageWindow([row(80), row(79)], [row(79), row(78)]).map((message) => message.seq), [80, 79, 78]);
});
