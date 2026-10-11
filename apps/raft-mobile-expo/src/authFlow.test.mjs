import test from "node:test";
import assert from "node:assert/strict";
import { canApplyAuthResult, createAuthFieldTracker, noteAuthFieldChange, noteAuthFieldEndEditing, noteAuthFieldFocus, snapshotAuthInput } from "./authFlow.ts";

test("auth snapshots preserve an intentionally cleared password", () => {
  assert.deepEqual(snapshotAuthInput({ email: "  person@example.test ", password: "" }), { email: "person@example.test", password: "" });
});

test("an immediate submit uses the latest onChangeText value", () => {
  let field = noteAuthFieldFocus(createAuthFieldTracker());
  field = noteAuthFieldChange(field, "correct-horse-battery");
  assert.equal(snapshotAuthInput({ email: "person@example.test", password: field.value }).password, "correct-horse-battery");
});

test("a stale end-editing event cannot restore a cleared password", () => {
  let field = noteAuthFieldFocus(createAuthFieldTracker("old-secret"));
  field = noteAuthFieldChange(field, "");
  field = noteAuthFieldEndEditing(field, "old-secret");
  assert.equal(field.value, "");
});

test("repeated stale end-editing events cannot restore a cleared password", () => {
  let field = noteAuthFieldFocus(createAuthFieldTracker("old-secret"));
  field = noteAuthFieldChange(field, "");
  field = noteAuthFieldEndEditing(field, "old-secret");
  field = noteAuthFieldEndEditing(field, "old-secret");
  assert.equal(field.value, "");
});

test("quickly switching fields keeps each field's latest legal value", () => {
  let password = noteAuthFieldFocus(createAuthFieldTracker());
  password = noteAuthFieldChange(password, "new-password-20");
  password = noteAuthFieldEndEditing(password, "new-password-20");
  let email = noteAuthFieldFocus(createAuthFieldTracker());
  email = noteAuthFieldChange(email, "person@example.test");
  email = noteAuthFieldEndEditing(email, "stale@example.test");
  assert.equal(password.value, "new-password-20");
  assert.equal(email.value, "person@example.test");
});

test("auth results are ignored after mode changes or a newer request", () => {
  assert.equal(canApplyAuthResult(3, 3, "login", "login"), true);
  assert.equal(canApplyAuthResult(4, 3, "login", "login"), false);
  assert.equal(canApplyAuthResult(3, 3, "register", "login"), false);
});
