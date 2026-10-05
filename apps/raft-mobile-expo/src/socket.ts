import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "./config";
import { readSession } from "./session";
import type { Message } from "./types";

export function createRaftSocket(serverId: string, getLastSeq: () => number, onMessage: (message: Message) => void, onNotification?: (payload: Record<string, unknown>) => void) {
  let socket: Socket | null = null;
  let stopped = false;

  const connect = async () => {
    const { accessToken } = await readSession();
    if (!accessToken || stopped) return;
    socket = io(API_BASE_URL, { transports: ["websocket"], autoConnect: false, auth: { token: accessToken, serverId, clientKind: "mobile" } });
    socket.on("message:new", onMessage);
    socket.on("sync:resume:response", ({ messages, currentSeq, hasMore }: { messages: Message[]; currentSeq: number; hasMore: boolean }) => {
      messages.forEach(onMessage);
      if (hasMore && currentSeq > 0) socket?.emit("sync:resume", { lastSeq: currentSeq });
    });
    socket.on("notification:push", (payload: Record<string, unknown>) => onNotification?.(payload));
    socket.on("rooms:joined", () => { const lastSeq = getLastSeq(); if (lastSeq > 0) socket?.emit("sync:resume", { lastSeq }); });
    socket.on("connect_error", () => { /* HTTP refresh is handled on next foreground connect */ });
    socket.connect();
  };
  void connect();
  return () => { stopped = true; socket?.removeAllListeners(); socket?.disconnect(); };
}
