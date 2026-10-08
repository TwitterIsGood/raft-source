export type Stage3Route = "tasks" | "wiki" | "members" | "computers";
export const STAGE3_ROUTES: ReadonlyArray<{ route: Stage3Route; title: string }> = [
  { route: "tasks", title: "任务" },
  { route: "wiki", title: "Wiki" },
  { route: "members", title: "成员" },
  { route: "computers", title: "电脑" },
];
export function isStage3Route(value: string): value is Stage3Route {
  return STAGE3_ROUTES.some((entry) => entry.route === value);
}

export type Stage3MemberSearchRow = {
  name: string;
  displayName?: string | null;
};

export type Stage3ServerRole = "owner" | "admin" | "member" | "guest";

/**
 * Match the Web member-role editor and the server transition policy.
 * Guest admission is deliberately excluded from this mobile foundation pass.
 */
export function getEditableStage3MemberRoles(input: {
  actorRole: Stage3ServerRole | null | undefined;
  targetRole: Stage3ServerRole;
  isSelf: boolean;
  ownerCount: number;
  guestEnabled?: boolean;
}): Stage3ServerRole[] {
  const { actorRole, targetRole, isSelf, ownerCount, guestEnabled = false } = input;
  if (isSelf || !actorRole || actorRole === "member" || actorRole === "guest") return [];
  const candidates: Stage3ServerRole[] = ["owner", "admin", "member"];
  if (guestEnabled) candidates.push("guest");
  return candidates.filter((nextRole) => {
    if (nextRole === targetRole) return false;
    if (targetRole === "guest" && !guestEnabled) return false;
    if (targetRole === "owner" && nextRole !== "owner" && ownerCount <= 1) return false;
    if (actorRole === "owner") return true;
    return actorRole === "admin" && targetRole === "member" && nextRole === "admin";
  });
}

/** Match the Web members page: handle or display name, case-insensitive. */
export function filterStage3Members<T extends Stage3MemberSearchRow>(rows: readonly T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...rows];
  return rows.filter((row) => row.name.toLocaleLowerCase().includes(normalized)
    || (row.displayName ?? "").toLocaleLowerCase().includes(normalized));
}
