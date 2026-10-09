import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string; webAppUrl?: string } | undefined;
const configured = process.env.EXPO_PUBLIC_RAFT_API_URL ?? extra?.apiBaseUrl;
const configuredPushEnvironment = process.env.EXPO_PUBLIC_APNS_ENV ?? (extra as { apnsEnv?: string } | undefined)?.apnsEnv;

export const API_BASE_URL = (configured || "https://bj1.v.lhb.ink:63204").replace(/\/$/, "");
export const WEB_APP_URL = (process.env.EXPO_PUBLIC_RAFT_WEB_URL ?? extra?.webAppUrl ?? "https://app.raft.build").replace(/\/$/, "");
export const SOCKET_ORIGIN = API_BASE_URL;
export const APP_ENV = __DEV__ ? "development" : "production";
// APNs sandbox/production is a signing choice, not a JS dev/release choice.
// Default to sandbox until a production build opts in explicitly.
export const PUSH_ENV = configuredPushEnvironment === "production" ? "production" : "sandbox";
