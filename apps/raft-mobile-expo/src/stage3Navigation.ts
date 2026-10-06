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
