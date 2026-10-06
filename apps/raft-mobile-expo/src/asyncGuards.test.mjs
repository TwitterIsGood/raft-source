import assert from "node:assert/strict";
import test from "node:test";
import { canClearComposerAfterSend, isCurrentAsyncScope } from "./asyncGuards.ts";

const scope = (epoch, channelId = "channel-a") => ({ epoch, serverId: "server-1", channelId });

function deferred() {
  let resolve;
  const promise = new Promise((value) => { resolve = value; });
  return { promise, resolve };
}

test("delayed picker and upload results are discarded after channel switch or logout", async () => {
  const picker = deferred();
  const upload = deferred();
  const expected = scope(1);
  let current = expected;
  let attachments = [];

  const run = (async () => {
    const picked = await picker.promise;
    if (!isCurrentAsyncScope(expected, current)) return;
    const uploaded = await upload.promise;
    if (!isCurrentAsyncScope(expected, current)) return;
    attachments = [...attachments, ...picked, ...uploaded];
  })();

  current = scope(1, "channel-b");
  picker.resolve(["picked-a"]);
  upload.resolve(["uploaded-a"]);
  await run;
  assert.deepEqual(attachments, []);

  current = expected;
  const picker2 = deferred();
  const upload2 = deferred();
  const run2 = (async () => {
    const picked = await picker2.promise;
    if (!isCurrentAsyncScope(expected, current)) return;
    const uploaded = await upload2.promise;
    if (!isCurrentAsyncScope(expected, current)) return;
    attachments = [...attachments, ...picked, ...uploaded];
  })();
  picker2.resolve(["picked-b"]);
  current = null;
  upload2.resolve(["uploaded-b"]);
  await run2;
  assert.deepEqual(attachments, []);
});

test("delayed page and send results cannot write after logout or clear new input", async () => {
  const expected = scope(1);
  let current = expected;
  let cache = [];
  const page = deferred();
  const pageRun = (async () => {
    const rows = await page.promise;
    if (!isCurrentAsyncScope(expected, current)) return;
    cache = [...cache, ...rows];
  })();
  current = null;
  page.resolve(["old-page"]);
  await pageRun;
  assert.deepEqual(cache, []);

  current = expected;
  const send = deferred();
  const sendRun = (async () => {
    await send.promise;
    const beforeSend = { draft: "old", attachmentIds: ["att-1"] };
    const now = { draft: "new", attachmentIds: ["att-1"] };
    assert.equal(canClearComposerAfterSend(expected, current, beforeSend, now), false);
  })();
  send.resolve({ id: "message-1" });
  await sendRun;

  assert.equal(canClearComposerAfterSend(expected, current, { draft: "", attachmentIds: ["att-1"] }, { draft: "", attachmentIds: ["att-1"] }), true);
  current = scope(2);
  assert.equal(canClearComposerAfterSend(expected, current, { draft: "", attachmentIds: [] }, { draft: "", attachmentIds: [] }), false);
});

test("operation generation rejects a stale upload after returning to the same channel", async () => {
  const expected = { ...scope(1), operation: 4 };
  let current = expected;
  const upload = deferred();
  let attachments = [];

  const run = (async () => {
    const picked = ["picked-a"];
    if (!isCurrentAsyncScope(expected, current)) return;
    const uploaded = await upload.promise;
    if (!isCurrentAsyncScope(expected, current)) return;
    attachments = [...picked, ...uploaded];
  })();

  // A→B→A has the same server/channel/epoch, but a new composer operation.
  current = { ...expected, operation: 6 };
  upload.resolve(["uploaded-a"]);
  await run;
  assert.deepEqual(attachments, []);
});
