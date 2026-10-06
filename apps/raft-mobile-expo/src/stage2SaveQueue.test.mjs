import test from "node:test";
import assert from "node:assert/strict";
import { enqueueMessageMutation } from "./stage2SaveQueue.ts";

test("same-message save intents run in click order while other messages stay independent", async () => {
  const tails = new Map();
  const events = [];
  let releaseFirst;
  const first = enqueueMessageMutation(tails, "a", async () => {
    events.push("a:save:start");
    await new Promise((resolve) => { releaseFirst = resolve; });
    events.push("a:save:end");
  });
  const second = enqueueMessageMutation(tails, "a", async () => { events.push("a:unsave"); });
  const other = enqueueMessageMutation(tails, "b", async () => { events.push("b:save"); });
  await other;
  assert.deepEqual(events, ["a:save:start", "b:save"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["a:save:start", "b:save", "a:save:end", "a:unsave"]);
});
