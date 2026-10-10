/**
 * Sponsor managers without invites:manage see only sponsor links, matching
 * the API's scope (H8, H43, #929).
 */
export function invitationScope({
  canInvite,
  canManageSponsors,
}: {
  canInvite: boolean;
  canManageSponsors: boolean;
}): "all" | "sponsor" | null {
  if (canInvite) return "all";
  return canManageSponsors ? "sponsor" : null;
}
