import { apiFetch } from "./api";
import {
  anonymizeOwnAccount,
  declineOwnSpot,
  deleteOwnAccount,
  fetchAccountRemovalEligibility,
  requestAccountRemovalPin,
} from "./self-service";

jest.mock("./api", () => ({ apiFetch: jest.fn() }));

const mockedApiFetch = jest.mocked(apiFetch);

beforeEach(() => mockedApiFetch.mockReset());

describe("mobile self-service account actions (H15, H54)", () => {
  it("loads the server's delete-vs-anonymize decision", async () => {
    mockedApiFetch.mockResolvedValueOnce({ action: "delete" });

    await fetchAccountRemovalEligibility();

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/me/removal-eligibility");
  });

  it("deletes only through the existing own-account endpoint", async () => {
    mockedApiFetch.mockResolvedValueOnce({ deleted: true });

    await deleteOwnAccount();

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/me", {
      method: "DELETE",
      headers: { "Idempotency-Key": expect.stringMatching(/^account-delete-/) },
    });
  });

  it("sends the removal PIN request through the authenticated endpoint", async () => {
    mockedApiFetch.mockResolvedValueOnce({ status: "sent", expiresAt: "2026-08-27T12:00:00.000Z" });

    await requestAccountRemovalPin();

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/me/removal-pin", { method: "POST" });
  });

  it("sends a security PIN when deleting a verified account", async () => {
    mockedApiFetch.mockResolvedValueOnce({ deleted: true });

    await deleteOwnAccount("123456");

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/me", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": expect.stringMatching(/^account-delete-/),
      },
      body: JSON.stringify({ securityPin: "123456" }),
    });
  });

  it("confirms irreversible anonymization through the own-account endpoint", async () => {
    mockedApiFetch.mockResolvedValueOnce({ anonymized: true });

    await anonymizeOwnAccount();

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/me/anonymize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": expect.stringMatching(/^account-anonymize-/),
      },
      body: JSON.stringify({ confirm: true }),
    });
  });

  it("sends a security PIN when anonymizing a verified account", async () => {
    mockedApiFetch.mockResolvedValueOnce({ anonymized: true });

    await anonymizeOwnAccount("123456");

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/me/anonymize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": expect.stringMatching(/^account-anonymize-/),
      },
      body: JSON.stringify({ confirm: true, securityPin: "123456" }),
    });
  });

  it("declines the selected response with its stable idempotency key", async () => {
    mockedApiFetch.mockResolvedValueOnce({ status: "declined" });

    await declineOwnSpot(42, "decline-key");

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/me/responses/42/decline", {
      method: "POST",
      headers: { "Idempotency-Key": "decline-key" },
    });
  });
});
