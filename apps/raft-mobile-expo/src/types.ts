export type Server = {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string | null;
  role?: string;
};

export type Channel = {
  id: string;
  name?: string | null;
  type?: string;
  serverId: string;
  joined?: boolean;
  archivedAt?: string | null;
  peerName?: string;
  peerDisplayName?: string | null;
};

export type Message = {
  id: string;
  seq?: number;
  channelId: string;
  senderType?: string;
  senderId?: string;
  senderName?: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  messageType?: string;
};
