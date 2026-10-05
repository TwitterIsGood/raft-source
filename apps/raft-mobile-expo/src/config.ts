import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
const configured = process.env.EXPO_PUBLIC_RAFT_API_URL ?? extra?.apiBaseUrl;

export const API_BASE_URL = (configured || "https://bj1.v.lhb.ink:63204").replace(/\/$/, "");
export const SOCKET_ORIGIN = API_BASE_URL;
export const APP_ENV = __DEV__ ? "development" : "production";
