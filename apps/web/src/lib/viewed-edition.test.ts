import { EDITION_HEADER } from "@hackos/shared/editions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, apiDownload, apiUpload } from "./api";
import {
  peekServerState,
  readServerState,
  resetServerStateForTests,
  serverStateEpoch,
} from "./server-state";
import { resetViewedEdition, setViewedEdition } from "./viewed-edition";

vi.mock("./download", () => ({ saveBlob: vi.fn() }));

afterEach(() => {
  resetViewedEdition();
  resetServerStateForTests();
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const sentHeader = (fetcher: ReturnType<typeof stubFetch>, call = 0) =>
  new Headers(fetcher.mock.calls[call][1]?.headers).get(EDITION_HEADER);

describe("viewed edition in the API client", () => {
  it("sends no edition header for the current edition", async () => {
    const fetcher = stubFetch();
    await api.get("/api/me");
    await api.post("/api/x", {});
    expect(sentHeader(fetcher, 0)).toBeNull();
    expect(sentHeader(fetcher, 1)).toBeNull();
  });

  it("sends X-Edition on JSON, upload and download requests once another edition is picked", async () => {
    const fetcher = stubFetch();
    setViewedEdition("edition-2025");
    await api.get("/api/me");
    await api.post("/api/x", {});
    await apiUpload("/api/up", new FormData());
    fetcher.mockResolvedValueOnce(new Response("a,b", { status: 200 }));
    await apiDownload("/api/export.csv", "export.csv");
    for (const call of [0, 1, 2, 3]) expect(sentHeader(fetcher, call)).toBe("edition-2025");

    setViewedEdition(null);
    await api.get("/api/me");
    expect(sentHeader(fetcher, 4)).toBeNull();
  });

  it("does not let a read after the switch join one made for the previous edition", async () => {
    const resolvers: Array<(r: Response) => void> = [];
    const fetcher = vi.fn(
      () => new Promise<Response>((resolve) => resolvers.push((r) => resolve(r))),
    );
    vi.stubGlobal("fetch", fetcher);
    const before = api.get("/api/me");
    setViewedEdition("edition-2025");
    const after = api.get("/api/me");
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const resolve of resolvers) resolve(new Response("{}", { status: 200 }));
    await Promise.all([before, after]);
  });

  it("drops cached reads and bumps the epoch on a switch, not on a no-op", async () => {
    await readServerState(["projects"], async () => ["old"]);
    expect(peekServerState(["projects"])).toEqual(["old"]);
    const epoch = serverStateEpoch();

    setViewedEdition(null);
    expect(serverStateEpoch()).toBe(epoch);
    expect(peekServerState(["projects"])).toEqual(["old"]);

    setViewedEdition("edition-2025");
    expect(serverStateEpoch()).toBe(epoch + 1);
    expect(peekServerState(["projects"])).toBeUndefined();
  });
});
