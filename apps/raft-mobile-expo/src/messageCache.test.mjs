import assert from "node:assert/strict";
import test from "node:test";
import { MessageCache } from "./messageCache.ts";

const row = (id, channelId, seq) => ({ id, channelId, seq, content: id, createdAt: "2026-01-01T00:00:00Z" });

test("interleaved channel and server responses stay in their own buckets", () => {
  const cache = new MessageCache();
  cache.merge("server-a", [row("a-1", "channel-1", 1)]);
  cache.merge("server-a", [row("a-2", "channel-2", 2)]);
  cache.merge("server-b", [row("b-1", "channel-1", 9)]);
  assert.deepEqual(cache.get("server-a", "channel-1").map((message) => message.id), ["a-1"]);
  assert.deepEqual(cache.get("server-a", "channel-2").map((message) => message.id), ["a-2"]);
  assert.deepEqual(cache.get("server-b", "channel-1").map((message) => message.id), ["b-1"]);
});

test("a live high sequence does not move the completed resume cursor", () => {
  const cache = new MessageCache();
  cache.advance("server-a", 10);
  cache.merge("server-a", [row("live", "channel-2", 90)]);
  assert.equal(cache.cursor("server-a"), 10);
  cache.merge("server-a", [row("missed", "channel-1", 11)]);
  cache.advance("server-a", 11);
  assert.equal(cache.cursor("server-a"), 11);
  assert.equal(cache.cursor("server-b"), 0);
});

test("duplicate live and sync deliveries collapse to one newest row", () => {
  const cache = new MessageCache();
  cache.merge("server-a", [row("m1", "channel-1", 1), row("m2", "channel-1", 2)]);
  cache.merge("server-a", [row("m2", "channel-1", 2), row("m3", "channel-1", 3)]);
  assert.deepEqual(cache.get("server-a", "channel-1").map((message) => message.id), ["m3", "m2", "m1"]);
});
