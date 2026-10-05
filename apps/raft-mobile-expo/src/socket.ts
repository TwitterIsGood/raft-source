import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "./config";
import { refreshAccessToken } from "./api";
import { readSession } from "./session";
import type { Message } from "./types";

export type RaftSocketHandle = (() => void) & { reconnect: () => void };

export function createRaftSocket(
  serverId: string,
  getLastSeq: () => number,
  onMessage: (message: Message) => void,
  onNotification?: (payload: Record<string, unknown>) => void,
  onResumeCursor?: (currentSeq: number, hasMore: boolean) => void,
  onHeartbeat?: (serverSeq: number) => void,
  onRoomsJoined?: () => void,
  onAuthExpired?: () => void,
): RaftSocketHandle {
  let socket: Socket | null = null;
  let stopped = false;
  let refreshing = false;

  const connect = async () => {
    const { accessToken } = await readSession();
    if (!accessToken || stopped) return;
    socket = io(API_BASE_URL, { transports: ["websocket"], autoConnect: false, auth: { token: accessToken, serverId, clientKind: "mobile" } });
    socket.on("message:new", onMessage);
    socket.on("sync:resume:response", ({ messages, currentSeq, hasMore }: { messages: Message[]; currentSeq: number; hasMore: boolean }) => {
      messages.forEach(onMessage);
      onResumeCursor?.(currentSeq, hasMore);
      if (hasMore && currentSeq > 0) socket?.emit("sync:resume", { lastSeq: currentSeq });
    });
    socket.on("notification:push", (payload: Record<string, unknown>) => onNotification?.(payload));
    socket.on("heartbeat", ({ seq }: { seq: number }) => { if (Number.isFinite(seq)) onHeartbeat?.(seq); });
    socket.on("rooms:joined", () => { const lastSeq = getLastSeq(); if (lastSeq > 0) socket?.emit("sync:resume", { lastSeq }); onRoomsJoined?.(); });
    socket.on("connect", () => { refreshing = false; });
    socket.on("connect_error", async (error) => {
      if (!/auth|token|expired|member/i.test(error.message)) return;
      if (refreshing || stopped) return;
      refreshing = true;
      const token = await refreshAccessToken();
      if (!token) { refreshing = false; socket?.disconnect(); onAuthExpired?.(); return; }
      if (stopped || !socket) { refreshing = false; return; }
      socket.auth = { token, serverId, clientKind: "mobile" };
      socket.connect();
      refreshing = false;
    });
    socket.connect();
  };
  void connect();
  const close = (() => { stopped = true; socket?.removeAllListeners(); socket?.disconnect(); }) as RaftSocketHandle;
  close.reconnect = () => {
    if (stopped) return;
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
    void connect();
  };
  return close;
}
