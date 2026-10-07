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

/** Match the Web members page: handle or display name, case-insensitive. */
export function filterStage3Members<T extends Stage3MemberSearchRow>(rows: readonly T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...rows];
  return rows.filter((row) => row.name.toLocaleLowerCase().includes(normalized)
    || (row.displayName ?? "").toLocaleLowerCase().includes(normalized));
}
