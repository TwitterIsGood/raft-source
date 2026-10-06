export type PushMarkerStatus = "registered" | "revoked";

export type PushMarkerIdentity = {
  serverId: string;
  userId: string;
  installationId: string;
};

export type PushRegistrationMarker = PushMarkerIdentity & {
  version: 1;
  status: PushMarkerStatus;
};

export type RuntimePushState = {
  identity: PushMarkerIdentity;
  status: "enabled" | "disabled";
} | null;

export function encodePushRegistrationMarker(marker: PushRegistrationMarker): string {
  return JSON.stringify(marker);
}

export function parsePushRegistrationMarker(value: string | null | undefined): PushRegistrationMarker | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PushRegistrationMarker>;
    if (parsed.version !== 1 || (parsed.status !== "registered" && parsed.status !== "revoked")) return null;
    if (typeof parsed.serverId !== "string" || typeof parsed.userId !== "string" || typeof parsed.installationId !== "string") return null;
    return parsed as PushRegistrationMarker;
  } catch {
    return null;
  }
}

export function markerMatchesIdentity(marker: PushRegistrationMarker | null, identity: PushMarkerIdentity): boolean {
  return Boolean(
    marker &&
    marker.serverId === identity.serverId &&
    marker.userId === identity.userId &&
    marker.installationId === identity.installationId,
  );
}

/** Historical SecureStore markers are not enough to claim the server is bound. */
export function resolveRuntimePushState(
  runtime: RuntimePushState,
  identity: PushMarkerIdentity,
  permissionGranted: boolean,
  isDevice: boolean,
): "enabled" | "disabled" | "unknown" | "unavailable" {
  if (!isDevice || !permissionGranted) return "unavailable";
  if (runtime && markerMatchesIdentity({ ...runtime.identity, version: 1, status: runtime.status === "enabled" ? "registered" : "revoked" }, identity)) return runtime.status;
  return "unknown";
}

export interface MarkerStore {
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** A failed local delete is replaced by a bound revoked tombstone. */
export async function clearPushRegistrationMarker(
  store: MarkerStore,
  key: string,
  identity: PushMarkerIdentity,
): Promise<"deleted" | "revoked" | "unknown"> {
  try {
    await store.deleteItemAsync(key);
    return "deleted";
  } catch {
    try {
      await store.setItemAsync(key, encodePushRegistrationMarker({ ...identity, version: 1, status: "revoked" }));
      return "revoked";
    } catch {
      return "unknown";
    }
  }
}
