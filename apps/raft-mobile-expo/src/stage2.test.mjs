import test from "node:test";
import assert from "node:assert/strict";
import { formatStage2Date } from "./stage2Api.ts";
import { createStage2Navigation, navigateStage2, stage2RouteTitle, isStage2Route, STAGE2_ROUTES } from "./stage2Navigation.ts";

 test("stage2 navigation starts at activity and changes only route", () => {
  const initial = createStage2Navigation("server-1");
  assert.deepEqual(initial, { serverId: "server-1", route: "activity" });
  assert.deepEqual(navigateStage2(initial, "saved"), { serverId: "server-1", route: "saved" });
  assert.strictEqual(navigateStage2(initial, "activity"), initial);
});

test("stage2 route metadata is stable and closed", () => {
  assert.deepEqual(STAGE2_ROUTES.map((row) => row.route), ["search", "activity", "saved"]);
  assert.equal(stage2RouteTitle("search"), "搜索");
  assert.equal(stage2RouteTitle("activity"), "动态");
  assert.equal(stage2RouteTitle("saved"), "保存");
  assert.equal(isStage2Route("saved"), true);
  assert.equal(isStage2Route("settings"), false);
});

test("stage2 date formatting fails closed instead of rendering Invalid Date", () => {
  assert.equal(formatStage2Date("not-a-date"), "时间未知");
  assert.notEqual(formatStage2Date("2026-10-06T09:00:00.000Z"), "Invalid Date");
});
