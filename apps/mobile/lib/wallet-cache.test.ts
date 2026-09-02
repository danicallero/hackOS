jest.mock("./api", () => ({ apiFetch: jest.fn() }));
jest.mock("./offline-cache", () => ({
  readCachedValue: jest.fn(),
  writeCachedValue: jest.fn(),
}));

import { apiFetch } from "./api";
import { readCachedValue, writeCachedValue } from "./offline-cache";
import { type WalletTicketPayload, walletCacheKey, warmWalletCache } from "./wallet-cache";

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockReadCachedValue = readCachedValue as jest.MockedFunction<typeof readCachedValue>;
const mockWriteCachedValue = writeCachedValue as jest.MockedFunction<typeof writeCachedValue>;

const payload: WalletTicketPayload = {
  userId: 42,
  ticketToken: "ticket-token",
  badgeId: "badge-42",
  applePassTypeIdentifier: "pass.hackos",
  applePassSerialNumbers: { ticket: "ticket-serial", badge: "badge-serial" },
  acceptedSpots: [
    {
      responseId: 1,
      applicationName: "Mentor track",
      grantedRoleName: "Mentor",
      expiresAt: null,
    },
  ],
};

describe("wallet cache", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockReadCachedValue.mockReset().mockResolvedValue(null);
    mockWriteCachedValue.mockReset().mockResolvedValue(undefined);
  });

  it("uses an account-scoped key", () => {
    expect(walletCacheKey(42)).toBe("user:42:wallet");
    expect(walletCacheKey(43)).not.toBe(walletCacheKey(42));
  });

  it("warms ticket details when no cached payload exists", async () => {
    mockApiFetch.mockResolvedValue(payload);

    await warmWalletCache(42);

    expect(mockApiFetch).toHaveBeenCalledWith("/api/me/ticket");
    expect(mockWriteCachedValue).toHaveBeenCalledWith("user:42:wallet", payload);
  });

  it("does not replace an existing payload during startup warmup", async () => {
    mockReadCachedValue.mockResolvedValue({ data: payload, updatedAt: "2026-08-23T10:00:00.000Z" });

    await warmWalletCache(42);

    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockWriteCachedValue).not.toHaveBeenCalled();
  });

  it("keeps startup failures non-blocking", async () => {
    mockApiFetch.mockRejectedValue(new Error("offline"));

    await expect(warmWalletCache(42)).resolves.toBeUndefined();
    expect(mockWriteCachedValue).not.toHaveBeenCalled();
  });
});
