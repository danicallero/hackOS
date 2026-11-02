import { beforeEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { loadUserDirectory } from "./user-directory";

vi.mock("./api", () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

it("loads users beyond the first 200 and forwards search and cancellation", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get)
    .mockResolvedValueOnce({ users: Array.from({ length: 200 }, (_, id) => ({ id })), total: 201 })
    .mockResolvedValueOnce({ users: [{ id: 200, name: "Older member" }], total: 201 });
  const result = await loadUserDirectory(signal, "member");
  expect(result.users).toHaveLength(201);
  expect(result.users[200].name).toBe("Older member");
  expect(api.get).toHaveBeenNthCalledWith(2, "/api/users", {
    query: { q: "member", limit: 200, offset: 200 },
    signal,
  });
});

it("does not return a truncated directory when a later batch fails", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ users: [{ id: 1 }], total: 2 })
    .mockRejectedValueOnce(new Error("offline"));
  await expect(loadUserDirectory(new AbortController().signal)).rejects.toThrow("offline");
});

it("stops on an empty batch when the directory shrinks during loading", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ users: [], total: 10 });
  expect((await loadUserDirectory(new AbortController().signal)).users).toEqual([]);
  expect(api.get).toHaveBeenCalledTimes(1);
});
