import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "./config";
import { createSessionStorage } from "./sessionStorage";

const ACCESS = "raft.accessToken";
const REFRESH = "raft.refreshToken";
const INSTALLATION = "raft.installationId";

// Only an unsigned simulator build pointed at the isolated test API may use
// an in-memory session. Physical devices always use SecureStore.
const isolatedSimulator = !Device.isDevice && API_BASE_URL === "http://127.0.0.1:13074";
const storage = createSessionStorage(SecureStore, isolatedSimulator);

let sessionGeneration = 0;

export function getSessionGeneration() {
  return sessionGeneration;
}

/** Invalidate all in-flight work before the local session is cleared. */
export function bumpSessionGeneration() {
  sessionGeneration += 1;
  return sessionGeneration;
}

export async function readSession() {
  return storage.read(ACCESS, REFRESH);
}

export async function saveSession(accessToken: string, refreshToken: string, guard?: () => boolean) {
  await storage.save(ACCESS, REFRESH, accessToken, refreshToken, guard);
}

export async function clearSession() {
  bumpSessionGeneration();
  await storage.clear(ACCESS, REFRESH);
}

export async function getInstallationId() {
  const existing = await SecureStore.getItemAsync(INSTALLATION);
  if (existing) return existing;
  const generated = `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(INSTALLATION, generated);
  return generated;
}
