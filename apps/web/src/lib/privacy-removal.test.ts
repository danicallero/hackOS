import { describe, expect, it } from "vitest";
import { type AccountRemovalEligibility, accountRemovalRequest } from "./privacy-removal";

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
    };
    expect(accountRemovalRequest(42, eligibility.action)).toEqual({ method, path });
  });
});
