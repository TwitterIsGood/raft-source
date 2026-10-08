import { api } from "./api";
import type { Stage3ServerRole } from "./stage3Navigation";

export type MobileTaskStatus = "todo" | "in_progress" | "in_review" | "done" | "closed";
export type MobileTask = {
  id: string;
  taskNumber: number;
  title: string;
  description?: string | null;
  status: MobileTaskStatus;
  channelId: string;
  channelName?: string | null;
  createdById?: string | null;
  createdByType?: "user" | "agent" | null;
  createdByName?: string | null;
  claimedByName?: string | null;
  claimedById?: string | null;
  updatedAt: string;
};
export type MobileMember = {
  userId: string;
  name: string;
  displayName: string | null;
  description: string | null;
  avatarUrl: string | null;
  role: Stage3ServerRole;
  joinedAt: string;
};
export type MobileComputer = {
  id: string;
  name: string;
  description: string | null;
  status: "online" | "offline";
  hostname: string | null;
  os: string | null;
  isComputer?: boolean;
  computerVersion?: string | null;
  daemonVersion: string | null;
  lastHeartbeat: string | null;
};
export type WikiArtifact = {
  id: string;
  artifactType: string;
  title: string;
  summary?: string | null;
  status?: string;
};
export type WikiDirectory = { pages: WikiArtifact[]; index: WikiArtifact | null; log: WikiArtifact | null };
export type WikiPage = WikiArtifact & { markdown?: string | null; content?: string | null };
export type WikiStatus = { space?: { status: string; wikiAgentName?: string | null } | null };

export function getServerTasks(serverId: string): Promise<{ tasks: MobileTask[] }> {
  return api("/api/tasks/server", {}, serverId);
}
export function createTask(serverId: string, channelId: string, title: string, description?: string): Promise<{ tasks: MobileTask[] }> {
  return api(`/api/tasks/channel/${encodeURIComponent(channelId)}`, {
    method: "POST",
    body: JSON.stringify({ tasks: [{ title, ...(description ? { description } : {}) }] }),
  }, serverId);
}
export function claimTask(serverId: string, taskId: string): Promise<{ task: MobileTask }> {
  return api(`/api/tasks/${encodeURIComponent(taskId)}/claim`, { method: "PATCH" }, serverId);
}
export function setTaskStatus(serverId: string, taskId: string, status: MobileTaskStatus): Promise<{ task: MobileTask }> {
  return api(`/api/tasks/${encodeURIComponent(taskId)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, serverId);
}
export function getWikiStatus(serverId: string): Promise<WikiStatus> {
  return api("/api/wiki/status", {}, serverId);
}
export function getWikiDirectory(serverId: string): Promise<WikiDirectory> {
  return api("/api/wiki/directory", {}, serverId);
}
export function refreshWiki(serverId: string): Promise<unknown> {
  return api("/api/wiki/refresh", { method: "POST" }, serverId);
}
export function getWikiPage(serverId: string, artifactId: string): Promise<WikiPage> {
  return api(`/api/wiki/artifacts/${encodeURIComponent(artifactId)}`, {}, serverId);
}
export function getServerMembers(serverId: string): Promise<MobileMember[]> {
  return api(`/api/servers/${encodeURIComponent(serverId)}/members`, {}, serverId);
}
export function updateServerMemberRole(serverId: string, userId: string, role: Stage3ServerRole): Promise<{ ok: boolean; changed: boolean }> {
  return api(`/api/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  }, serverId);
}
export function addServerMember(serverId: string, userId: string, role: Exclude<Stage3ServerRole, "guest"> = "member"): Promise<{ ok: boolean; added: boolean }> {
  return api(`/api/servers/${encodeURIComponent(serverId)}/members`, {
    method: "POST",
    body: JSON.stringify({ userId, role }),
  }, serverId);
}
export function removeServerMember(serverId: string, userId: string): Promise<{ ok: boolean }> {
  return api(`/api/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  }, serverId);
}
export async function getServerComputers(serverId: string): Promise<MobileComputer[]> {
  const response = await api<MobileComputer[] | { machines?: MobileComputer[] }>(`/api/servers/${encodeURIComponent(serverId)}/machines`, {}, serverId);
  return Array.isArray(response) ? response : response.machines ?? [];
}
export function updateServerComputer(serverId: string, machineId: string, patch: { name?: string; description?: string | null }): Promise<MobileComputer> {
  return api(`/api/servers/${encodeURIComponent(serverId)}/machines/${encodeURIComponent(machineId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }, serverId);
}
