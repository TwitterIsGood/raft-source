import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoScrollAfterSend } from "./messageScroll.ts";

test("sending at the latest edge may auto-scroll", () => {
  assert.equal(shouldAutoScrollAfterSend(0), true);
  assert.equal(shouldAutoScrollAfterSend(80), true);
});

test("sending while reading history preserves the current position", () => {
  assert.equal(shouldAutoScrollAfterSend(81), false);
  assert.equal(shouldAutoScrollAfterSend(320), false);
  assert.equal(shouldAutoScrollAfterSend(Number.NaN), false);
});
