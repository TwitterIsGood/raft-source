// Which build of Raft this is. The private repository is "cloud", our own
// deployment. scripts/source-available/export-snapshot.ts rewrites the one
// line below to "source-available" in every published snapshot, and the
// export fails unless it finds exactly that line.
//
// The source-available edition has no social account login (Google, GitHub,
// Apple): services/socialAuthService.ts refuses it whatever the environment
// configures. Nor does it have enterprise single sign-on (OIDC and SAML, with
// "Require SSO"): routes/sso.ts and routes/serverSso.ts refuse every route, and
// services/sso/ssoEnforcement.ts enforces no requirement, whatever rows the
// database holds.
//
// The edition also selects the human user limit below: "cloud" has none, so
// this deployment is not capped by HUMAN_USER_LIMIT.
export const RAFT_EDITION: "cloud" | "source-available" = "cloud";

/** Whether this edition offers social account login at all; providers still need their configuration. */
export function socialLoginAllowed(edition: string = RAFT_EDITION): boolean {
  return edition === "cloud";
}

/** Whether this edition offers enterprise single sign-on (OIDC, SAML, "Require SSO") at all. */
export function enterpriseSsoAllowed(edition: string = RAFT_EDITION): boolean {
  return edition === "cloud";
}

/**
 * The user cap of the source-available edition (services/deploymentUserLimit.ts
 * says which accounts count and refuses the change that would add one more).
 * Unused on this "cloud" deployment, whose limit is null.
 */
export const HUMAN_USER_LIMIT = 5;

/** The most Human User Accounts this edition lets a Deployment have, or null for no limit (cloud). */
export function humanUserLimit(edition: string = RAFT_EDITION): number | null {
  return edition === "source-available" ? HUMAN_USER_LIMIT : null;
}
