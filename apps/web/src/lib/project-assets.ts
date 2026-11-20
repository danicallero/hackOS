import { API_URL } from "@/lib/env";

/**
 * Absolute URL of a project upload. A module function rather than a prop, so
 * server pages can render the client project components without handing them
 * a function (which React refuses to serialize).
 */
export function projectAssetUrl(path: string) {
  return new URL(path, API_URL).toString();
}
