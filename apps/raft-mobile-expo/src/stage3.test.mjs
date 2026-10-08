import assert from "node:assert/strict";
import test from "node:test";
import { canRemoveStage3Member, createStage3RequestTracker, filterStage3Members, getEditableStage3MemberRoles, getStage3AddMemberRoles, isStage3ResponseCurrent, isStage3Route, STAGE3_ROUTES } from "./stage3Navigation.ts";

test("stage3 workspace routes cover tasks, wiki, members and computers", () => {
  assert.deepEqual(STAGE3_ROUTES.map((item) => item.route), ["tasks", "wiki", "members", "computers"]);
  assert.equal(isStage3Route("wiki"), true);
  assert.equal(isStage3Route("settings"), false);
});

test("stage3 member search matches handle and display name and restores on clear", () => {
  const rows = [
    { name: "alice", displayName: "Alice Chen" },
    { name: "builder", displayName: "Mobile Test" },
    { name: "Zed", displayName: null },
  ];
  assert.deepEqual(filterStage3Members(rows, "  ALI  "), [rows[0]]);
  assert.deepEqual(filterStage3Members(rows, "mobile"), [rows[1]]);
  assert.deepEqual(filterStage3Members(rows, "missing"), []);
  assert.deepEqual(filterStage3Members(rows, ""), rows);
});

test("stage3 member role editor follows Web/API transition rules", () => {
  assert.deepEqual(getEditableStage3MemberRoles({ actorRole: "owner", targetRole: "member", isSelf: false, ownerCount: 1 }), ["owner", "admin"]);
  assert.deepEqual(getEditableStage3MemberRoles({ actorRole: "owner", targetRole: "owner", isSelf: false, ownerCount: 1 }), []);
  assert.deepEqual(getEditableStage3MemberRoles({ actorRole: "owner", targetRole: "owner", isSelf: false, ownerCount: 2 }), ["admin", "member"]);
  assert.deepEqual(getEditableStage3MemberRoles({ actorRole: "admin", targetRole: "member", isSelf: false, ownerCount: 1 }), ["admin"]);
  assert.deepEqual(getEditableStage3MemberRoles({ actorRole: "admin", targetRole: "admin", isSelf: false, ownerCount: 1 }), []);
  assert.deepEqual(getEditableStage3MemberRoles({ actorRole: "owner", targetRole: "member", isSelf: true, ownerCount: 2 }), []);
});

test("stage3 member add/remove rules follow Web/API permissions", () => {
  assert.deepEqual(getStage3AddMemberRoles("owner"), ["owner", "admin", "member"]);
  assert.deepEqual(getStage3AddMemberRoles("admin"), ["admin", "member"]);
  assert.deepEqual(getStage3AddMemberRoles("member"), []);
  assert.equal(canRemoveStage3Member({ actorRole: "owner", targetRole: "member", isSelf: false, ownerCount: 1 }), true);
  assert.equal(canRemoveStage3Member({ actorRole: "admin", targetRole: "member", isSelf: false, ownerCount: 1 }), true);
  assert.equal(canRemoveStage3Member({ actorRole: "admin", targetRole: "admin", isSelf: false, ownerCount: 1 }), false);
  assert.equal(canRemoveStage3Member({ actorRole: "owner", targetRole: "owner", isSelf: false, ownerCount: 1 }), false);
  assert.equal(canRemoveStage3Member({ actorRole: "owner", targetRole: "owner", isSelf: false, ownerCount: 2 }), true);
  assert.equal(canRemoveStage3Member({ actorRole: "owner", targetRole: "member", isSelf: true, ownerCount: 2 }), false);
});

test("stage3 member request tracker rejects late workspace and request responses", () => {
  const tracker = createStage3RequestTracker();
  tracker.beginScope();
  const first = tracker.beginRequest();
  const second = tracker.beginRequest();
  assert.equal(tracker.isCurrent(first), false);
  assert.equal(tracker.isCurrent(second), true);
  tracker.beginScope();
  assert.equal(tracker.isScopeCurrent(first.scope), false);
  assert.equal(tracker.isCurrent(second), false);
});

test("stage3 late load errors are rejected after a newer request or session", () => {
  const tracker = createStage3RequestTracker();
  tracker.beginScope();
  const stale = tracker.beginRequest();
  const current = tracker.beginRequest();
  assert.equal(isStage3ResponseCurrent(tracker, stale, 4, 4), false);
  assert.equal(isStage3ResponseCurrent(tracker, current, 4, 5), false);
  assert.equal(isStage3ResponseCurrent(tracker, current, 4, 4), true);
});
