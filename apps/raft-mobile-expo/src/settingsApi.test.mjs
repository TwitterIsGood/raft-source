import test from "node:test";
import assert from "node:assert/strict";
import { normalizeServerNotificationSettings } from "./settingsModel.ts";

test("notification settings normalize legacy muted and mentions fields", () => {
  assert.deepEqual(normalizeServerNotificationSettings({ serverPushMuted: true, prefsVersion: 4 }), {
    serverPushMuted: true,
    serverPushMentionsOnly: false,
    serverPushMode: "none",
    prefsVersion: 4,
  });
  assert.deepEqual(normalizeServerNotificationSettings({ serverPushMode: "mentions", prefsVersion: 2 }), {
    serverPushMuted: false,
    serverPushMentionsOnly: true,
    serverPushMode: "mentions",
    prefsVersion: 2,
  });
});

test("notification settings fail closed to all for unknown mode", () => {
  assert.deepEqual(normalizeServerNotificationSettings({ serverPushMode: "unexpected" }), {
    serverPushMuted: false,
    serverPushMentionsOnly: false,
    serverPushMode: "all",
    prefsVersion: 0,
  });
});
