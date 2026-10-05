import * as SecureStore from "expo-secure-store";

const ACCESS = "raft.accessToken";
const REFRESH = "raft.refreshToken";
const INSTALLATION = "raft.installationId";

export async function readSession() {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS),
    SecureStore.getItemAsync(REFRESH),
  ]);
  return { accessToken, refreshToken };
}

export async function saveSession(accessToken: string, refreshToken: string) {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS, accessToken),
    SecureStore.setItemAsync(REFRESH, refreshToken),
  ]);
}

export async function clearSession() {
  await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]);
}

export async function getInstallationId() {
  const existing = await SecureStore.getItemAsync(INSTALLATION);
  if (existing) return existing;
  const generated = `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(INSTALLATION, generated);
  return generated;
}
