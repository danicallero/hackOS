import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEmailLinkToken } from "@/hooks/use-email-link-token";
import { api } from "@/lib/api";
import { useTokenAction } from "./lib";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function Landing({ actionName }: { actionName: "confirm" | "decline" }) {
  const token = useEmailLinkToken(null);
  const action = useTokenAction<{ status: string }>({
    token,
    endpoint: `/api/applications/${actionName}`,
    isExpired: () => false,
    invalidLinkMessage: "invalid",
    fallbackMessage: "failed",
  });
  return (
    <button type="button" onClick={() => void action.retry()}>
      {action.state}
    </button>
  );
}

describe("scanner-safe acceptance link", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it.each([
    "confirm",
    "decline",
  ] as const)("%s does not POST on load and removes the bearer token from the address bar", async (actionName) => {
    window.history.replaceState(null, "", `/applications/${actionName}#token=secret`);
    const historyWrite = vi.spyOn(window.history, "replaceState");
    const post = vi.spyOn(api, "post").mockResolvedValue({ status: "confirmed" });
    await act(async () => root.render(<Landing actionName={actionName} />));
    await act(async () => root.render(<Landing actionName={actionName} />));
    expect(container.textContent).toBe("ready");
    expect(post).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain("secret");
    expect(historyWrite).toHaveBeenCalledOnce();
    await act(async () => container.querySelector("button")?.click());
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0]?.[0]).toBe(`/api/applications/${actionName}`);
    expect(post.mock.calls[0]?.[1]).toEqual({ token: "secret" });
  });
});
