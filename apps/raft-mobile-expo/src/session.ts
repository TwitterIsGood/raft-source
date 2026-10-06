import * as SecureStore from "expo-secure-store";

const ACCESS = "raft.accessToken";
const REFRESH = "raft.refreshToken";
const INSTALLATION = "raft.installationId";

let sessionGeneration = 0;
let volatileAccessToken: string | null = null;
let volatileRefreshToken: string | null = null;

const SECURE_STORE_TIMEOUT_MS = 1_500;

async function secureRead(key: string): Promise<string | null> {
  try {
    return await Promise.race([
      SecureStore.getItemAsync(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SECURE_STORE_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

async function secureWrite(key: string, value: string): Promise<void> {
  try {
    await Promise.race([
      SecureStore.setItemAsync(key, value),
      new Promise<void>((resolve) => setTimeout(resolve, SECURE_STORE_TIMEOUT_MS)),
    ]);
  } catch {
    // The in-memory copy remains valid for this process. A later launch will
    // require a fresh login if the platform keychain is unavailable.
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    await Promise.race([
      SecureStore.deleteItemAsync(key),
      new Promise<void>((resolve) => setTimeout(resolve, SECURE_STORE_TIMEOUT_MS)),
    ]);
  } catch {
    // Best effort: local volatile state is cleared by the caller.
  }
}

export function getSessionGeneration() {
  return sessionGeneration;
}

/** Invalidate all in-flight work before the local session is cleared. */
export function bumpSessionGeneration() {
  sessionGeneration += 1;
  return sessionGeneration;
}

export async function readSession() {
  if (volatileAccessToken || volatileRefreshToken) return { accessToken: volatileAccessToken, refreshToken: volatileRefreshToken };
  const [accessToken, refreshToken] = await Promise.all([secureRead(ACCESS), secureRead(REFRESH)]);
  return { accessToken, refreshToken };
}

export async function saveSession(accessToken: string, refreshToken: string) {
  volatileAccessToken = accessToken;
  volatileRefreshToken = refreshToken;
  await Promise.all([secureWrite(ACCESS, accessToken), secureWrite(REFRESH, refreshToken)]);
}

export async function clearSession() {
  bumpSessionGeneration();
  volatileAccessToken = null;
  volatileRefreshToken = null;
  await Promise.all([secureDelete(ACCESS), secureDelete(REFRESH)]);
}

export async function getInstallationId() {
  const existing = await SecureStore.getItemAsync(INSTALLATION);
  if (existing) return existing;
  const generated = `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(INSTALLATION, generated);
  return generated;
}
