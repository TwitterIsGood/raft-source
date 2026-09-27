import assert from "node:assert/strict";
import test from "node:test";
import { randomId } from "../src/utils/randomId";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("randomId prefers crypto.randomUUID when the context exposes it", () => {
  const original = crypto.randomUUID;
  let calls = 0;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () => {
      calls += 1;
      return "11111111-2222-4333-8444-555555555555";
    },
  });
  try {
    assert.equal(randomId(), "11111111-2222-4333-8444-555555555555");
    assert.equal(calls, 1);
  } finally {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: original });
  }
});

// The deployed instance is served over plain HTTP, where the browser omits
// `crypto.randomUUID` entirely (secure-context-only). A bare call therefore
// threw inside the composer's file-picker handler and silently dropped every
// selected attachment.
test("randomId still mints a UUIDv4 without crypto.randomUUID", () => {
  const original = crypto.randomUUID;
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  try {
    const ids = new Set(Array.from({ length: 64 }, () => randomId()));
    assert.equal(ids.size, 64);
    for (const id of ids) assert.match(id, UUID_V4);
  } finally {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: original });
  }
});
