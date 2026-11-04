import { describe, expect, it, vi } from "vitest";
import type { Translate } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { mutateMembership } from "./membership-mutation";

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-error-text", () => ({
  apiErrorText: (_error: unknown, _translate: Translate, fallback: string) => fallback,
}));

const t: Translate = (key) => key;

describe("enterprise membership mutations", () => {
  it("keeps the action busy until the refreshed membership list is available", async () => {
    const transitions: boolean[] = [];
    const afterRequest = vi.fn();
    let finishRefresh = () => {};
    const refreshed = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const refresh = vi.fn(() => refreshed);
    const pending = mutateMembership({
      request: async () => {},
      refresh,
      afterRequest,
      setBusy: (busy) => transitions.push(busy),
      t,
      success: "Added",
      failure: "Could not add",
      title: "Add member",
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(afterRequest).toHaveBeenCalledOnce();
    expect(transitions).toEqual([true]);
    finishRefresh();
    await pending;
    expect(transitions).toEqual([true, false]);
    expect(toast.success).toHaveBeenCalledWith("Added", { compactTitle: "Add member" });
  });

  it("does not clear selection or refresh after a rejected request and unlocks the action", async () => {
    const refresh = vi.fn();
    const afterRequest = vi.fn();
    const setBusy = vi.fn();
    await mutateMembership({
      request: async () => {
        throw new Error("Rejected");
      },
      refresh,
      afterRequest,
      setBusy,
      t,
      success: "Removed",
      failure: "Could not remove",
      title: "Remove judge",
    });
    expect(afterRequest).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(toast.error).toHaveBeenCalledWith("Could not remove", "Remove judge");
  });
});
