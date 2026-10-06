export type Stage2Route = "search" | "activity" | "saved";
export type Stage2NavigationState = { route: Stage2Route; serverId: string };

export const STAGE2_ROUTES: ReadonlyArray<{ route: Stage2Route; title: string; icon: string }> = [
  { route: "search", title: "搜索", icon: "⌕" },
  { route: "activity", title: "动态", icon: "◷" },
  { route: "saved", title: "保存", icon: "☆" },
];

export function stage2RouteTitle(route: Stage2Route): string {
  return STAGE2_ROUTES.find((entry) => entry.route === route)?.title ?? "";
}

export function createStage2Navigation(serverId: string, route: Stage2Route = "activity"): Stage2NavigationState {
  return { serverId, route };
}

export function navigateStage2(state: Stage2NavigationState, route: Stage2Route): Stage2NavigationState {
  return state.route === route ? state : { ...state, route };
}

export function isStage2Route(value: string): value is Stage2Route {
  return STAGE2_ROUTES.some((entry) => entry.route === value);
}
