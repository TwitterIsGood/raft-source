// Which build of Raft this is. The private repository is "cloud", our own
// deployment. scripts/source-available/export-snapshot.ts rewrites the one
// line below to "source-available" in every published snapshot, and the
// export fails unless it finds exactly that line.
//
// The edition selects the human user limit below: "cloud" has none, so this
// deployment is not capped by HUMAN_USER_LIMIT.
//
// This deployment also turns social account login (Google, GitHub, Apple) and
// enterprise single sign-on (OIDC, SAML, "Require SSO") off outright: this
// instance authenticates with email and password only, whatever the
// environment configures and whatever rows the database holds.
export const RAFT_EDITION: "cloud" | "source-available" = "cloud";

/** Social account login is disabled on this deployment. */
export function socialLoginAllowed(_edition: string = RAFT_EDITION): boolean {
  return false;
}

/** Enterprise single sign-on (OIDC, SAML, "Require SSO") is disabled on this deployment. */
export function enterpriseSsoAllowed(_edition: string = RAFT_EDITION): boolean {
  return false;
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
