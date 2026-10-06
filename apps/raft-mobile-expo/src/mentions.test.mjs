import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMentionCandidateGroups,
  buildStructuredMentions,
  findMentionTrigger,
  insertMentionAtCursor,
  normalizeStructuredMentions,
  rankMentionCandidates,
  structuredMentionStillAppears,
  toStructuredMention,
} from "./mentions.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";

const candidate = (overrides = {}) => ({
  id: USER_ID,
  name: "Alice",
  displayName: "Alice Chen",
  type: "user",
  ...overrides,
});

test("mention candidate search is stable and supports display name/server label", () => {
  const rows = [
    candidate(),
    candidate({ id: AGENT_ID, name: "build-bot", displayName: "Build Bot", type: "agent", serverName: "Build" }),
    candidate({ id: "33333333-3333-4333-8333-333333333333", name: "Bob", displayName: "Bob" }),
    candidate({ id: "44444444-4444-4444-8444-444444444444", name: "Alice Ops", displayName: "Alice Ops", serverName: "Build" }),
  ];
  assert.deepEqual(rankMentionCandidates(rows, "alice").map((row) => row.name), ["Alice", "Alice Ops"]);
  assert.deepEqual(rankMentionCandidates(rows, "build").map((row) => row.name), ["build-bot", "Alice Ops"]);
  assert.deepEqual(rankMentionCandidates(rows, "").map((row) => row.name), ["Alice", "build-bot", "Bob", "Alice Ops"]);
});

test("candidate groups separate member people, non-members and resource refs", () => {
  const rows = [
    candidate({ id: "33333333-3333-4333-8333-333333333333", name: "member" }),
    candidate({ id: "44444444-4444-4444-8444-444444444444", name: "outsider" }),
    candidate({ id: "55555555-5555-4555-8555-555555555555", name: "Mac", type: "computer" }),
    candidate({ id: "calendar.app", name: "calendar.app", type: "app" }),
  ];
  const groups = buildMentionCandidateGroups({
    candidates: rows,
    channelMemberIds: new Set(["33333333-3333-4333-8333-333333333333"]),
  });
  assert.deepEqual(groups.inChannel.map((row) => row.name), ["member"]);
  assert.deepEqual(groups.notInChannel.map((row) => row.name), ["outsider"]);
  assert.deepEqual(groups.computers.map((row) => row.name), ["Mac"]);
  assert.deepEqual(groups.apps.map((row) => row.name), ["calendar.app"]);
  assert.deepEqual(groups.flat.map((row) => row.name), ["member", "outsider", "Mac", "calendar.app"]);
});

test("thread participant prioritization uses most recent sender and keeps ties stable", () => {
  const rows = [
    candidate({ id: "33333333-3333-4333-8333-333333333333", name: "First" }),
    candidate({ id: "44444444-4444-4444-8444-444444444444", name: "Latest" }),
    candidate({ id: "55555555-5555-4555-8555-555555555555", name: "Never" }),
  ];
  const groups = buildMentionCandidateGroups({
    candidates: rows,
    channelMemberIds: new Set(rows.map((row) => row.id)),
    threadSenderIds: [rows[0].id, rows[1].id],
    prioritizeThreadParticipants: true,
  });
  assert.deepEqual(groups.inChannel.map((row) => row.name), ["Latest", "First", "Never"]);
});

test("find and insert mention at cursor preserve text and return selected identity", () => {
  const content = "请看 @Ali后续";
  const cursor = "请看 @Ali".length;
  assert.deepEqual(findMentionTrigger(content, cursor), { start: 3, end: cursor, query: "Ali" });
  const inserted = insertMentionAtCursor(content, cursor, candidate({ name: "Alice" }));
  assert.equal(inserted.content, "请看 @Alice 后续");
  assert.equal(inserted.cursor, "请看 @Alice ".length);
  assert.deepEqual(inserted.mention, { type: "user", id: USER_ID, name: "Alice" });
  assert.equal(findMentionTrigger("mail alice@example.com", 21), null);
});

test("server structured mention contract rejects invalid data and deduplicates exact triples", () => {
  assert.deepEqual(toStructuredMention(candidate()), { type: "user", id: USER_ID, name: "Alice" });
  assert.equal(toStructuredMention(candidate({ id: "not-a-uuid" })), null);
  assert.equal(toStructuredMention(candidate({ type: "computer" })), null);

  const valid = normalizeStructuredMentions([
    { type: "user", id: USER_ID, name: " Alice " },
    { type: "user", id: USER_ID, name: "Alice" },
    { type: "agent", id: AGENT_ID, name: "build-bot" },
  ]);
  assert.deepEqual(valid, [
    { type: "user", id: USER_ID, name: "Alice" },
    { type: "agent", id: AGENT_ID, name: "build-bot" },
  ]);
  assert.equal(normalizeStructuredMentions([{ type: "user", id: "bad", name: "x" }]), null);
  assert.deepEqual(normalizeStructuredMentions([{ type: "user", id: USER_ID, name: "display name" }]), [
    { type: "user", id: USER_ID, name: "display name" },
  ]);
  assert.equal(normalizeStructuredMentions([{ type: "user", id: USER_ID, name: "   " }]), null);
  assert.deepEqual(normalizeStructuredMentions(undefined), []);
});

test("stale selections are removed while free-text handles remain server-resolvable", () => {
  assert.equal(structuredMentionStillAppears("hello @Alice", "Alice"), true);
  assert.equal(structuredMentionStillAppears("hello `@Alice`", "Alice"), false);
  assert.equal(structuredMentionStillAppears("hello [@Mac](<computer:55555555-5555-4555-8555-555555555555>)", "Mac"), false);
  assert.equal(structuredMentionStillAppears("hello \\<@Alice>", "Alice"), false);
  assert.equal(structuredMentionStillAppears("hello @AliceOps", "Alice"), false);

  assert.deepEqual(buildStructuredMentions("hello @Alice and @build-bot", [
    { type: "user", id: USER_ID, name: "Alice" },
    { type: "agent", id: AGENT_ID, name: "build-bot" },
  ]), [
    { type: "user", id: USER_ID, name: "Alice" },
    { type: "agent", id: AGENT_ID, name: "build-bot" },
  ]);
  assert.deepEqual(buildStructuredMentions("edited the selected person away", [{ type: "user", id: USER_ID, name: "Alice" }]), []);
  assert.deepEqual(buildStructuredMentions("hello @Alice [@Mac](<computer:55555555-5555-4555-8555-555555555555>)", [
    { type: "user", id: USER_ID, name: "Alice" },
    { type: "computer", id: "55555555-5555-4555-8555-555555555555", name: "Mac" },
  ]), [{ type: "user", id: USER_ID, name: "Alice" }]);
});
