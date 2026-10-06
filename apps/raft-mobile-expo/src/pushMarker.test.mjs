import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPushRegistrationMarker,
  encodePushRegistrationMarker,
  markerMatchesIdentity,
  parsePushRegistrationMarker,
} from "./pushMarker.ts";

const identity = { serverId: "server-a", userId: "user-a", installationId: "ios-install-a" };

test("push marker binds registration evidence to server, account, and installation", () => {
  const encoded = encodePushRegistrationMarker({ ...identity, version: 1, status: "registered" });
  const marker = parsePushRegistrationMarker(encoded);
  assert.equal(markerMatchesIdentity(marker, identity), true);
  assert.equal(markerMatchesIdentity(marker, { ...identity, userId: "user-b" }), false);
  assert.equal(markerMatchesIdentity(marker, { ...identity, installationId: "ios-install-b" }), false);
  assert.equal(markerMatchesIdentity(marker, { ...identity, serverId: "server-b" }), false);
  assert.equal(markerMatchesIdentity(parsePushRegistrationMarker("registered"), identity), false);
});

test("unregister delete failure writes a revoked tombstone", async () => {
  let stored = encodePushRegistrationMarker({ ...identity, version: 1, status: "registered" });
  const calls = [];
  const store = {
    async deleteItemAsync(key) { calls.push(["delete", key]); throw new Error("keychain delete failed"); },
    async setItemAsync(key, value) { calls.push(["set", key]); stored = value; },
  };
  const result = await clearPushRegistrationMarker(store, "raft.push.registration.server-a", identity);
  assert.equal(result, "revoked");
  assert.deepEqual(calls.map(([kind]) => kind), ["delete", "set"]);
  const marker = parsePushRegistrationMarker(stored);
  assert.equal(marker?.status, "revoked");
  assert.equal(markerMatchesIdentity(marker, identity), true);
});

test("unregister reports unknown only when both delete and tombstone writes fail", async () => {
  const store = {
    async deleteItemAsync() { throw new Error("delete failed"); },
    async setItemAsync() { throw new Error("set failed"); },
  };
  assert.equal(await clearPushRegistrationMarker(store, "key", identity), "unknown");
});
