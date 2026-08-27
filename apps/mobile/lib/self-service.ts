import { apiFetch } from "./api";

export interface AccountRemovalEligibility {
  action: "delete" | "anonymize";
  reasonCode: "fresh_account" | "operational_history" | "inconsistent_operational_reference";
  accessRevoked: true;
  operationalHistoryRetained: boolean;
  activeEventConsequences: boolean;
  requiresVenueExit: boolean;
  integrityWarning: boolean;
}

export interface AccountRemovalResponse {
  status: "completed" | "pending_exit" | "processing";
  deleted?: true;
  anonymized?: true;
  pendingExit?: true;
  accessRevoked?: true;
}

export function fetchAccountRemovalEligibility(): Promise<AccountRemovalEligibility> {
  return apiFetch<AccountRemovalEligibility>("/api/me/removal-eligibility");
}

function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export function deleteOwnAccount(): Promise<AccountRemovalResponse> {
  return apiFetch<AccountRemovalResponse>("/api/me", {
    method: "DELETE",
    headers: { "Idempotency-Key": makeIdempotencyKey("account-delete") },
  });
}

export function anonymizeOwnAccount(): Promise<AccountRemovalResponse> {
  return apiFetch<AccountRemovalResponse>("/api/me/anonymize", {
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
