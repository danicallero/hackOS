import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { intentKey, settleIntentKey } from "./intent-key";

afterEach(() => vi.unstubAllGlobals());

describe("intentKey", () => {
  it("reuses the key until a definitive answer, then mints a new one", () => {
    const first = intentKey("POST /a {}");
    expect(intentKey("POST /a {}")).toBe(first);
    settleIntentKey("POST /a {}", 503);
    expect(intentKey("POST /a {}")).toBe(first);
    settleIntentKey("POST /a {}", null);
    expect(intentKey("POST /a {}")).toBe(first);
    settleIntentKey("POST /a {}", 200);
    expect(intentKey("POST /a {}")).not.toBe(first);
  });

  it("gives a changed payload a new key", () => {
    expect(intentKey('POST /b {"x":1}')).not.toBe(intentKey('POST /b {"x":2}'));
  });
});

describe("apiFetch retry after a lost response", () => {
  it("sends the same Idempotency-Key on the user's retry, a new one after success", async () => {
    const keys: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_u: string, init: RequestInit) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        throw new TypeError("network");
      })
      .mockImplementation(async (_u: string, init: RequestInit) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/api/invites", { method: "POST", body: { e: "a" } })).rejects.toThrow();
    await apiFetch("/api/invites", { method: "POST", body: { e: "a" } });
    await apiFetch("/api/invites", { method: "POST", body: { e: "a" } });
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
