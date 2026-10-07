import assert from "node:assert/strict";
import test from "node:test";
import { filterStage3Members, isStage3Route, STAGE3_ROUTES } from "./stage3Navigation.ts";

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
