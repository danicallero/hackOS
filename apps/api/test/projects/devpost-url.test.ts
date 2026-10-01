import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeDevpostUrl, resolveDevpostUrl } from "../../src/modules/projects/devpost-url.js";

afterEach(() => vi.unstubAllGlobals());

describe("Devpost identities (H16/#854)", () => {
  it("normalizes public links without contacting Devpost", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      await resolveDevpostUrl(
        " HTTP://WWW.DEVPOST.COM/software/BlackVault-m92vqk/?ref=share#demo ",
      ),
    ).toBe("https://devpost.com/software/blackvault-m92vqk");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resolves the CSV submission redirect to its public identity", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://devpost.com/software/blackvault-m92vqk" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await resolveDevpostUrl(
        "https://hackudc-2026.devpost.com/submissions/954962-blackvault?ref=export",
      ),
    ).toBe("https://devpost.com/software/blackvault-m92vqk");
    expect(fetcher).toHaveBeenCalledWith(
      "https://hackudc-2026.devpost.com/submissions/954962-blackvault",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("does not follow an external redirect or request unsafe URLs", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await resolveDevpostUrl("https://event.devpost.com/submissions/123-project")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const url of [
      "https://devpost.com.evil.test/software/test",
      "http://127.0.0.1/software/test",
      "https://user:pass@devpost.com/software/test",
      "https://devpost.com:8080/software/test",
    ]) {
      expect(normalizeDevpostUrl(url)).toBeNull();
    }
  });

  it("bounds redirect loops and tolerates outages", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "/submissions/123-project" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await resolveDevpostUrl("https://event.devpost.com/submissions/123-project")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(5);
    fetcher.mockRejectedValue(new Error("Unavailable"));
    expect(await resolveDevpostUrl("https://event.devpost.com/submissions/123-project")).toBeNull();
  });
});
