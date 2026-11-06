import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

function deferredFetch() {
  const calls: { signal?: AbortSignal; resolve: (body: unknown) => void }[] = [];
  const fetcher = vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError")));
      calls.push({
        signal: init?.signal ?? undefined,
        resolve: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })),
      });
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, calls };
}

describe("concurrent GET coalescing (#1227)", () => {
  it("shares one request between identical in-flight GETs and hands out separate copies", async () => {
    const { fetcher, calls } = deferredFetch();
    const a = api.get<{ n: number[] }>("/api/me");
    const b = api.get<{ n: number[] }>("/api/me");
    expect(fetcher).toHaveBeenCalledOnce();
    calls[0].resolve({ n: [1] });
    const [left, right] = await Promise.all([a, b]);
    expect(left).toEqual({ n: [1] });
    expect(right).toEqual({ n: [1] });
    expect(left).not.toBe(right);
  });

  it("does not share different URLs, mutations, or sequential reads", async () => {
    const { fetcher, calls } = deferredFetch();
    const a = api.get("/api/a");
    const b = api.get("/api/a", { query: { q: "x" } });
    const c = api.post("/api/a", {});
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const call of calls) call.resolve({});
    await Promise.all([a, b, c]);
    const d = api.get("/api/a");
    expect(fetcher).toHaveBeenCalledTimes(4);
    calls[3].resolve({});
    await d;
  });

  it("aborts the network request only when every caller has aborted", async () => {
    const { fetcher, calls } = deferredFetch();
    const first = new AbortController();
    const second = new AbortController();
    const a = api.get("/api/x", { signal: first.signal });
    const b = api.get("/api/x", { signal: second.signal });
    expect(fetcher).toHaveBeenCalledOnce();
    first.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0].signal?.aborted).toBe(false);
    second.abort();
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it("lets a surviving caller finish after another aborts", async () => {
    const { calls } = deferredFetch();
    const gone = new AbortController();
    const a = api.get("/api/y", { signal: gone.signal });
    const b = api.get("/api/y");
    gone.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    calls[0].resolve({ ok: true });
    await expect(b).resolves.toEqual({ ok: true });
  });

  it("starts a fresh request after an aborted one", async () => {
    const { fetcher, calls } = deferredFetch();
    const gone = new AbortController();
    const a = api.get("/api/z", { signal: gone.signal });
    gone.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    const b = api.get("/api/z");
    expect(fetcher).toHaveBeenCalledTimes(2);
    calls[1].resolve({ ok: 1 });
    await expect(b).resolves.toEqual({ ok: 1 });
  });
});
