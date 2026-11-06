import { afterEach, describe, expect, it, vi } from "vitest";

const saveBlob = vi.hoisted(() => vi.fn());
vi.mock("./download", () => ({ saveBlob }));

import { ApiError, api, apiDownload, apiUpload, parseExportFailures } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function respondWith(body: BodyInit | null, init: ResponseInit) {
  const fetcher = vi.fn(async () => new Response(body, init));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const envelope = JSON.stringify({ error: { code: "forbidden_thing", message: "No." } });

describe("one error path for JSON, upload and download", () => {
  it("raises the same ApiError, with Retry-After, from every transport", async () => {
    const headers = { "retry-after": "7" };
    for (const call of [
      () => api.post("/api/x", {}),
      () => apiUpload("/api/x", new FormData()),
      () => apiDownload("/api/x", "x.csv"),
    ]) {
      respondWith(envelope, { status: 429, headers });
      await expect(call()).rejects.toMatchObject({
        status: 429,
        code: "forbidden_thing",
        message: "No.",
        retryAfter: 7,
      });
    }
  });

  it("still raises an ApiError when a proxy answers with an HTML page", async () => {
    respondWith("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" });
    await expect(apiUpload("/api/x", new FormData())).rejects.toBeInstanceOf(ApiError);
  });
});

describe("apiDownload", () => {
  it("POSTs a JSON body with an idempotency key, saves the file and returns the headers", async () => {
    const fetcher = respondWith("zip", {
      status: 200,
      headers: {
        "content-disposition": 'attachment; filename="server-name.zip"',
        "x-export-file-failures": JSON.stringify({ total: 2, items: [] }),
      },
    });

    const headers = await apiDownload("/api/exports/a.zip", "fallback.zip", {
      method: "POST",
      body: { ids: [1] },
    });

    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ ids: [1] }));
    expect(new Headers(init.headers).get("Idempotency-Key")).toBeTruthy();
    expect(saveBlob).toHaveBeenCalledOnce();
    expect(saveBlob.mock.calls[0]?.[1]).toBe("server-name.zip");
    expect(parseExportFailures<{ total: number }>(headers)).toEqual({ total: 2, items: [] });
  });
});

describe("parseExportFailures", () => {
  it("ignores a missing, malformed or empty report", () => {
    expect(parseExportFailures(new Headers())).toBeNull();
    expect(parseExportFailures(new Headers({ "x-export-file-failures": "{oops" }))).toBeNull();
    expect(
      parseExportFailures(new Headers({ "x-export-file-failures": '{"total":0}' })),
    ).toBeNull();
  });
});
