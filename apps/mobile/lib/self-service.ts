import { apiFetch } from "./api";

export interface AccountRemovalEligibility {
  action: "delete" | "anonymize";
  reasonCode: "fresh_account" | "operational_history" | "inconsistent_operational_reference";
  accessRevoked: true;
  operationalHistoryRetained: boolean;
  activeEventConsequences: boolean;
  requiresVenueExit: boolean;
  integrityWarning: boolean;
  securityPinRequired: boolean;
}

export interface AccountRemovalPinResponse {
  status: "sent" | "not_required";
  expiresAt?: string;
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

export function requestAccountRemovalPin(): Promise<AccountRemovalPinResponse> {
  return apiFetch<AccountRemovalPinResponse>("/api/me/removal-pin", { method: "POST" });
}

function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export function deleteOwnAccount(securityPin?: string): Promise<AccountRemovalResponse> {
  return apiFetch<AccountRemovalResponse>("/api/me", {
    method: "DELETE",
    headers: {
      ...(securityPin ? { "content-type": "application/json" } : {}),
      "Idempotency-Key": makeIdempotencyKey("account-delete"),
    },
    ...(securityPin ? { body: JSON.stringify({ securityPin }) } : {}),
  });
}

export function anonymizeOwnAccount(securityPin?: string): Promise<AccountRemovalResponse> {
  return apiFetch<AccountRemovalResponse>("/api/me/anonymize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": makeIdempotencyKey("account-anonymize"),
    },
    body: JSON.stringify({ confirm: true, ...(securityPin ? { securityPin } : {}) }),
  });
}

export function cancelPendingAnonymization(): Promise<{ status: "cancelled" }> {
  return apiFetch<{ status: "cancelled" }>("/api/me/anonymize/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function declineOwnSpot(responseId: number, idempotencyKey: string): Promise<unknown> {
  return apiFetch(`/api/me/responses/${responseId}/decline`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
