import test from "node:test";
import assert from "node:assert/strict";
import { canApplyAuthResult, snapshotAuthInput } from "./authFlow.ts";

test("auth snapshots preserve an intentionally cleared password", () => {
  assert.deepEqual(snapshotAuthInput({ email: "  person@example.test ", password: "" }), { email: "person@example.test", password: "" });
});

test("auth results are ignored after mode changes or a newer request", () => {
  assert.equal(canApplyAuthResult(3, 3, "login", "login"), true);
  assert.equal(canApplyAuthResult(4, 3, "login", "login"), false);
  assert.equal(canApplyAuthResult(3, 3, "register", "login"), false);
});
