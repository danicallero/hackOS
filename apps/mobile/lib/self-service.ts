import { apiFetch } from "./api";

export interface AccountRemovalEligibility {
  action: "delete" | "anonymize";
  reasonCode: "fresh_account" | "operational_history";
  accessRevoked: true;
  operationalHistoryRetained: boolean;
}

export function fetchAccountRemovalEligibility(): Promise<AccountRemovalEligibility> {
  return apiFetch<AccountRemovalEligibility>("/api/me/removal-eligibility");
}

export function deleteOwnAccount(): Promise<unknown> {
  return apiFetch("/api/me", { method: "DELETE" });
}

export function declineOwnSpot(responseId: number, idempotencyKey: string): Promise<unknown> {
  return apiFetch(`/api/me/responses/${responseId}/decline`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
