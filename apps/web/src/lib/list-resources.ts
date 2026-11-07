import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { api } from "@/lib/api";
import { readServerState, type ServerStateKey } from "@/lib/server-state";
import { loadUserDirectory } from "@/lib/user-directory";

/**
 * Cache key + request for each workspace's main list. Pages read through these
 * (stale-while-revalidate, see `lib/server-state.ts`) and the navigation
 * warm-up below reads the very same entries, so hovering a link fills the
 * cache the destination paints from.
 */
interface ListResource {
  key: ServerStateKey;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export const challengesResource = (admin: boolean): ListResource => ({
  key: ["challenges", admin ? "all" : "mine"],
  path: admin ? "/api/challenges" : "/api/challenges/mine",
});
export const enterprisesResource: ListResource = {
  key: ["enterprises", "list"],
  path: "/api/enterprises",
};
export const applicationsResource: ListResource = {
  key: ["applications", "forms"],
  path: "/api/applications",
};
const projectsResource: ListResource = {
  key: ["projects", "management"],
  path: "/api/repos",
};
/** The users roster resolves through `loadUserDirectory` (all pages), keyed by search text. */
export const usersDirectoryKey = (q: string): ServerStateKey => ["users", "directory", q];
export const scheduleResource: ListResource = { key: ["schedule", "items"], path: "/api/schedule" };

export function fetchListResource<T>(resource: ListResource, signal?: AbortSignal): Promise<T> {
  return api.get<T>(resource.path, { signal, query: resource.query });
}

/** List resources a link to `href` will read, for the caller's capabilities. */
function resourcesFor(href: string, can: (capability: Capability) => boolean): ListResource[] {
  switch (href) {
    case "/challenges":
      return [
        challengesResource(can(CAPABILITIES.SPONSORS_MANAGE) || can(CAPABILITIES.QUEUE_ADMIN)),
      ];
    case "/enterprises":
      return can(CAPABILITIES.SPONSORS_MANAGE) ? [enterprisesResource] : [];
    case "/applications":
      return can(CAPABILITIES.APPLICATIONS_MANAGE) ? [applicationsResource] : [];
    case "/projects":
      return can(CAPABILITIES.PROJECTS_READ) ? [projectsResource] : [];
    case "/users":
      return [];
    case "/schedule":
      return can(CAPABILITIES.SCHEDULE_READ) || can(CAPABILITIES.SCHEDULE_MANAGE)
        ? [scheduleResource]
        : [];
    default:
      return [];
  }
}

/**
 * Warm the cache for a destination list on hover/focus. Cheap by design: only
 * routes with a known list, only when the cache has no fresh value, and a
 * failure is ignored because the page itself reads (and reports) again.
 */
export function warmRoute(href: string, can: (capability: Capability) => boolean): void {
  if (href === "/users" && can(CAPABILITIES.USERS_READ)) {
    readServerState(usersDirectoryKey(""), (signal) => loadUserDirectory(signal, "")).catch(
      () => undefined,
    );
  }
  for (const resource of resourcesFor(href, can)) {
    readServerState(resource.key, (signal) => fetchListResource(resource, signal)).catch(
      () => undefined,
    );
  }
}
