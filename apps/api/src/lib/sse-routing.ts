import { SSE_TOPICS } from "@hackos/shared/events";

/**
 * Map mutation routes to the narrow read-model topic they can affect.
 * Payload-free refresh signals keep unrelated browser surfaces asleep while
 * the domain services retain ownership of richer operational events (H29-H53).
 */
export function mutationDomainForPath(url: string): string | null {
  const path = url.split("?", 1)[0] ?? url;
  const matches = (prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

  // Application forms and responses share one read-model domain (H11-H15).
  if (
    matches("/api/applications") ||
    matches("/api/responses") ||
    matches("/api/me/applications") ||
    matches("/api/me/responses")
  ) {
    return SSE_TOPICS.APPLICATIONS;
  }

  // Devpost/projects and queue membership edits are project read-model writes
  // even when the URL is nested under a challenge (H16-H21).
  if (
    matches("/api/projects") ||
    matches("/api/repos") ||
    matches("/api/devpost") ||
    matches("/api/me/projects") ||
    /^\/api\/challenges\/[^/]+\/repos(?:\/|$)/.test(path)
  ) {
    return SSE_TOPICS.PROJECTS;
  }

  // Sponsor-owned enterprises and challenges have their own authenticated
  // workspace topic; public-facing writes are mirrored separately below.
  if (
    matches("/api/enterprises") ||
    matches("/api/challenges") ||
    matches("/api/invites/enterprise-links")
  ) {
    return SSE_TOPICS.SPONSORS;
  }

  // These catalogues are maintained by logistics staff and consumed by the
  // application/profile/scanner read models (H7, H12, H22-H27).
  if (
    matches("/api/universities") ||
    matches("/api/public/universities/propose") ||
    matches("/api/food-intolerances")
  ) {
    return SSE_TOPICS.LOGISTICS;
  }

  // Identity mutations affect users, invitations, and the capability graph
  // (H7-H10). Application-specific /api/me paths were handled above.
  if (
    matches("/api/me") ||
    matches("/api/users") ||
    matches("/api/permissions") ||
    matches("/api/permission-groups") ||
    matches("/api/permission-group-templates") ||
    matches("/api/invites") ||
    matches("/api/profile")
  ) {
    return SSE_TOPICS.IDENTITY;
  }

  // Event configuration is public content even though only staff can edit it
  // (H42, H47-H49). Announcements and schedule services own their richer
  // events, so they are intentionally not mapped through this fallback.
  if (matches("/api/event")) {
    return SSE_TOPICS.CONTENT;
  }

  return null;
}

/**
 * Public projections have a stricter ownership boundary than the authenticated
 * sponsor workspace. Only mutations that can change an anonymous sponsor or
 * challenge projection wake `public-content`; private rosters, invite links,
 * queue groups and judging data stay on authenticated topics (H45, #533).
 */
export function publicContentMutationForPath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? url;
  const singleResource = (prefix: string): boolean => new RegExp(`^${prefix}/[^/]+$`).test(path);

  return (
    path === "/api/enterprises" ||
    path === "/api/enterprises/visibility" ||
    singleResource("/api/enterprises") ||
    /^\/api\/enterprises\/[^/]+\/logo$/.test(path) ||
    path === "/api/challenges" ||
    path === "/api/challenges/visibility" ||
    singleResource("/api/challenges") ||
    /^\/api\/challenges\/[^/]+\/(?:publish|unpublish)$/.test(path) ||
    /^\/api\/devpost\/prizes\/[^/]+\/map$/.test(path)
  );
}
