export type AuthInputSnapshot = { email: string; password: string };

export type AuthFieldTracker = {
  value: string;
  editVersion: number;
  focusedVersion: number | null;
};

export function createAuthFieldTracker(value = ""): AuthFieldTracker {
  return { value, editVersion: 0, focusedVersion: null };
}

export function noteAuthFieldFocus(tracker: AuthFieldTracker): AuthFieldTracker {
  return { ...tracker, focusedVersion: tracker.editVersion };
}

export function noteAuthFieldChange(tracker: AuthFieldTracker, value: string): AuthFieldTracker {
  return { value, editVersion: tracker.editVersion + 1, focusedVersion: tracker.focusedVersion };
}

/**
 * Native end-editing events can arrive after the last onChangeText event.
 * Accept them only when this focus session produced no edits, or when they
 * agree with the latest change. This preserves an intentional clear and
 * ignores a stale value delivered by a secure native field.
 */
export function noteAuthFieldEndEditing(tracker: AuthFieldTracker, eventValue: string): AuthFieldTracker {
  // A native field may emit more than one late end-editing event. Once the
  // current focus session has ended, accept only an event that agrees with the
  // value already captured by onChangeText; never reintroduce an older value.
  const focusIsActive = tracker.focusedVersion !== null;
  const shouldApply = eventValue === tracker.value || (focusIsActive && tracker.editVersion === tracker.focusedVersion);
  return { value: shouldApply ? eventValue : tracker.value, editVersion: tracker.editVersion, focusedVersion: null };
}

/** Capture exactly what the fields contain; an empty password must stay empty. */
export function snapshotAuthInput(values: AuthInputSnapshot): AuthInputSnapshot {
  return { email: values.email.trim(), password: values.password };
}

export function canApplyAuthResult(currentRequest: number, requestId: number, currentMode: string, requestMode: string): boolean {
  return currentRequest === requestId && currentMode === requestMode;
}
