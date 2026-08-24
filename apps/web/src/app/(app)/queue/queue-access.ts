export interface QueueOperationsAccessInput {
  canOperate: boolean;
  canAdmin: boolean;
  canJudge: boolean;
  canManageSponsors: boolean;
  isSponsorRep: boolean;
}

/** Capability/association gate shared by the queue page's access and tab choice (H46/H55). */
export function queueOperationsAccess(input: QueueOperationsAccessInput) {
  const canViewRooms = input.canOperate || input.canAdmin || input.canJudge;
  const canManageQueues = input.canAdmin || input.canManageSponsors || input.isSponsorRep;
  return {
    canViewRooms,
    canManageQueues,
    canUse: canViewRooms || canManageQueues,
    defaultTab: canViewRooms ? ("rooms" as const) : ("queues" as const),
  };
}
