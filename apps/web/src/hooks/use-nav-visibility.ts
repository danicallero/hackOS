"use client";

import { isNavItemVisible, type NavItem } from "@/lib/nav";
import { useSessionContext } from "@/lib/session";

/** Sidebar visibility predicate (H8/H55), shared with quick search (#1182). */
export function useNavVisibility() {
  const { can, canAny, me, isPureApplicant } = useSessionContext();
  return (item: NavItem) =>
    isNavItemVisible(item, {
      can,
      canAny,
      isEnterpriseJudge: me?.isEnterpriseJudge ?? false,
      isSponsorRep: me?.isSponsorRep ?? false,
      isPureApplicant,
      // Default true while `me` is still loading, matching isPureApplicant's
      // "show, then narrow down" pattern so the sidebar doesn't flash empty.
      hasProject: me ? me.hasProject || me.canCreateProject : true,
      hasQueueItems: me ? me.hasQueueItems : true,
      hasStatisticsPanels: me ? me.hasStatisticsPanels : true,
    });
}
