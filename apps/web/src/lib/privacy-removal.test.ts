import { beforeEach, describe, expect, it } from "vitest";
import {
  type AccountRemovalEligibility,
  accountRemovalIdempotencyKey,
  accountRemovalRequest,
  clearAccountRemovalProgress,
  clearWebAccountData,
  readAccountRemovalProgress,
  saveAccountRemovalProgress,
} from "./privacy-removal";

class MemoryStorage {
  get length(): number {
    return Object.keys(this).length;
  }

  key(index: number): string | null {
    return Object.keys(this)[index] ?? null;
  }

  getItem(key: string): string | null {
    return Object.hasOwn(this, key) ? String((this as Record<string, unknown>)[key]) : null;
  }

  setItem(key: string, value: string): void {
    Object.defineProperty(this, key, {
      configurable: true,
      enumerable: true,
      value: String(value),
      writable: true,
    });
  }

  removeItem(key: string): void {
    delete (this as Record<string, unknown>)[key];
  }

  clear(): void {
    for (const key of Object.keys(this)) delete (this as Record<string, unknown>)[key];
  }
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
});

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
      integrityWarning: false,
      securityPinRequired: false,
      reauthenticationRequired: false,
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

  it.each([
    "pending_exit",
    "processing",
    "device_cleanup_pending",
  ] as const)("stores restart-safe %s progress without an identity", (status) => {
    saveAccountRemovalProgress({ action: "anonymize", status });

    expect(readAccountRemovalProgress()).toEqual({ action: "anonymize", status });
    expect(window.localStorage.getItem("hackos:account-removal-progress")).not.toContain("email");

    clearAccountRemovalProgress();
    expect(readAccountRemovalProgress()).toBeNull();
  });
});
