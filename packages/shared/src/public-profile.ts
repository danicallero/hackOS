/** Public profile settings shared by API, web and mobile (#934, #935). */

/** Body/response field: show me on the public TV networking graph. */
export const TV_GRAPH_VISIBLE_FIELD = "tvGraphVisible" as const;

/** On until the person opts out; also the value when no profile row exists. */
export const TV_GRAPH_VISIBLE_DEFAULT = true;

/** Optional in PUT /api/me/public-profile (omitted keeps the stored value); always in responses. */
export interface TvGraphVisibility {
  tvGraphVisible: boolean;
}
