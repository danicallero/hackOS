export type AccountRemovalAction = "delete" | "anonymize";

export interface AccountRemovalEligibility {
  action: AccountRemovalAction;
  reasonCode: string;
  accessRevoked: true;
  operationalHistoryRetained: boolean;
}

export function accountRemovalRequest(userId: number, action: AccountRemovalAction) {
  return action === "delete"
    ? { method: "DELETE" as const, path: `/api/users/${userId}` }
    : { method: "POST" as const, path: `/api/users/${userId}/anonymize` };
}
