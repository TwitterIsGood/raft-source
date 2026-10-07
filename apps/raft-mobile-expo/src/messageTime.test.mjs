import test from "node:test";
import assert from "node:assert/strict";
import { formatMessageTime, normalizeMessageCreatedAt } from "./messageTime.ts";

test("message timestamps normalize valid wire values", () => {
  assert.equal(normalizeMessageCreatedAt("2026-10-07T12:34:56.000Z"), "2026-10-07T12:34:56.000Z");
  assert.equal(normalizeMessageCreatedAt(0), "1970-01-01T00:00:00.000Z");
});

test("invalid or missing message timestamps fail closed", () => {
  assert.equal(normalizeMessageCreatedAt("not-a-date"), "");
  assert.equal(normalizeMessageCreatedAt(undefined), "");
  assert.equal(formatMessageTime("not-a-date"), "时间未知");
  assert.equal(formatMessageTime(""), "时间未知");
  assert.notEqual(formatMessageTime("2026-10-07T12:34:56.000Z"), "Invalid Date");
});
