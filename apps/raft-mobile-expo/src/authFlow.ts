export type AuthInputSnapshot = { email: string; password: string };

/** Capture exactly what the fields contain; an empty password must stay empty. */
export function snapshotAuthInput(values: AuthInputSnapshot): AuthInputSnapshot {
  return { email: values.email.trim(), password: values.password };
}

export function canApplyAuthResult(currentRequest: number, requestId: number, currentMode: string, requestMode: string): boolean {
  return currentRequest === requestId && currentMode === requestMode;
}
