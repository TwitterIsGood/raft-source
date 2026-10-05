import assert from "node:assert/strict";
import test from "node:test";
import { completedCursor, isCurrentScope, NotificationResponseDeduper, sendableDraft } from "./behavior.ts";

test("stale channel response is rejected after switching scope", () => {
  assert.equal(isCurrentScope({ serverId: "s1", channelId: "a" }, { serverId: "s1", channelId: "b" }), false);
  assert.equal(isCurrentScope({ serverId: "s1", channelId: "a" }, { serverId: "s1", channelId: "a" }), true);
});

test("resume cursor advances only on the final ordered page", () => {
  assert.equal(completedCursor(10, 50, true), 10);
  assert.equal(completedCursor(10, 50, false), 50);
  assert.equal(completedCursor(50, Number.NaN, false), 50);
});

test("notification response IDs are consumed once", () => {
  const deduper = new NotificationResponseDeduper();
  assert.equal(deduper.accept("response-1"), true);
  assert.equal(deduper.accept("response-1"), false);
  assert.equal(deduper.accept("response-2"), true);
  assert.equal(deduper.accept(undefined), true);
});

test("Chinese multiline draft keeps internal newlines and is sendable", () => {
  assert.equal(sendableDraft("  第一行\n第二行  "), "第一行\n第二行");
});
