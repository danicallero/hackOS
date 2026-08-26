import { apiFetch } from "./api";

export interface AccountRemovalEligibility {
  action: "delete" | "anonymize";
  reasonCode: "fresh_account" | "operational_history";
  accessRevoked: true;
  operationalHistoryRetained: boolean;
  activeEventConsequences: boolean;
  requiresVenueExit: boolean;
  retainedFields: string[];
}

export function fetchAccountRemovalEligibility(): Promise<AccountRemovalEligibility> {
  return apiFetch<AccountRemovalEligibility>("/api/me/removal-eligibility");
}

function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export function deleteOwnAccount(): Promise<unknown> {
  return apiFetch("/api/me", {
    method: "DELETE",
    headers: { "Idempotency-Key": makeIdempotencyKey("account-delete") },
  });
}

export function anonymizeOwnAccount(): Promise<unknown> {
  return apiFetch("/api/me/anonymize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": makeIdempotencyKey("account-anonymize"),
    },
    body: JSON.stringify({ confirm: true }),
  });
}

export function declineOwnSpot(responseId: number, idempotencyKey: string): Promise<unknown> {
  return apiFetch(`/api/me/responses/${responseId}/decline`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
