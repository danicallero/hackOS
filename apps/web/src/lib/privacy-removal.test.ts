import { describe, expect, it } from "vitest";
import {
  type AccountRemovalEligibility,
  accountRemovalIdempotencyKey,
  accountRemovalRequest,
  clearWebAccountData,
} from "./privacy-removal";

describe("account removal eligibility", () => {
  it.each([
    ["delete", "DELETE", "/api/users/42"],
    ["anonymize", "POST", "/api/users/42/anonymize"],
  ] as const)("selects %s before confirmation", (action, method, path) => {
    const eligibility: AccountRemovalEligibility = {
      action,
      reasonCode: action === "delete" ? "fresh_account" : "operational_history",
      accessRevoked: true,
      operationalHistoryRetained: action === "anonymize",
      activeEventConsequences: action === "anonymize",
      requiresVenueExit: false,
      retainedFields: action === "anonymize" ? ["age"] : [],
    };
    expect(accountRemovalRequest(42, eligibility.action)).toEqual({ method, path });
  });

  it("creates a unique idempotency key per destructive attempt", () => {
    const first = accountRemovalIdempotencyKey("delete");
    const second = accountRemovalIdempotencyKey("delete");
    expect(first).toMatch(/^account-delete-/);
    expect(second).not.toBe(first);
  });

  it("clears app-owned browser state after account closure", () => {
    window.localStorage.setItem("hackos:profile", "identity");
    window.localStorage.setItem("queue-ops-arrival-hints", "1");
    window.localStorage.setItem("unrelated-app", "keep");
    window.sessionStorage.setItem("profile-cache", "identity");

    clearWebAccountData();

    expect(window.localStorage.getItem("hackos:profile")).toBeNull();
    expect(window.localStorage.getItem("queue-ops-arrival-hints")).toBeNull();
    expect(window.localStorage.getItem("unrelated-app")).toBe("keep");
    expect(window.sessionStorage.length).toBe(0);
  });
});
