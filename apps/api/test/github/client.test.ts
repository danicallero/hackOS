import "./env.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BadRequestError } from "../../src/lib/errors.js";
import { exchangeUserCode } from "../../src/modules/github/client.js";

const tokenUrl = "https://github.com/login/oauth/access_token";
const userUrl = "https://api.github.com/user";
const installationsUrl = "https://api.github.com/user/installations?per_page=100";

describe("GitHub OAuth client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts both authenticated reads while the profile response is still pending", async () => {
    let resolveProfile!: (response: Response) => void;
    const profile = new Promise<Response>((resolve) => {
      resolveProfile = resolve;
    });
    const fetchMock = vi.fn(async (url: string) => {
      switch (url) {
        case tokenUrl:
          return Response.json({ access_token: "user-token" });
        case userUrl:
          return profile;
        case installationsUrl:
          return Response.json({ installations: [{ id: 23 }, { id: 57 }] });
        default:
          throw new Error(`Unexpected GitHub URL: ${url}`);
      }
    });
    vi.stubGlobal("fetch", fetchMock);

    const exchange = exchangeUserCode("code");
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(fetchMock.mock.calls[0]?.[0]).toBe(tokenUrl);
      for (const url of [userUrl, installationsUrl]) {
        expect(fetchMock).toHaveBeenCalledWith(
          url,
          expect.objectContaining({
            headers: expect.objectContaining({ Authorization: "Bearer user-token" }),
          }),
        );
      }
    } finally {
      resolveProfile(Response.json({ id: 42, login: "octocat" }));
      await exchange;
    }
    await expect(exchange).resolves.toEqual({
      githubId: 42,
      login: "octocat",
      installationIds: [23, 57],
    });
  });

  it("rejects an unsuccessful token exchange before making authenticated reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "bad_verification_code" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeUserCode("code")).rejects.toThrow(
      new BadRequestError("GitHub authorization failed"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([userUrl, installationsUrl])("rejects when %s fails", async (failedUrl) => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === tokenUrl) return Response.json({ access_token: "user-token" });
      if (url === failedUrl) return Response.json({}, { status: 403 });
      if (url === userUrl) return Response.json({ id: 42, login: "octocat" });
      if (url === installationsUrl) return Response.json({ installations: [] });
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });

    await expect(exchangeUserCode("code")).rejects.toThrow(
      new BadRequestError("GitHub request failed (403)", {
        path: failedUrl.slice("https://api.github.com".length),
      }),
    );
  });
});
