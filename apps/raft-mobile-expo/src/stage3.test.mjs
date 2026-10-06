import assert from "node:assert/strict";
import test from "node:test";
import { isStage3Route, STAGE3_ROUTES } from "./stage3Navigation.ts";

test("stage3 workspace routes cover tasks, wiki, members and computers", () => {
  assert.deepEqual(STAGE3_ROUTES.map((item) => item.route), ["tasks", "wiki", "members", "computers"]);
  assert.equal(isStage3Route("wiki"), true);
  assert.equal(isStage3Route("settings"), false);
});
