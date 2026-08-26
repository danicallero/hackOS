import { apiFetch } from "./api";
import { declineOwnSpot, deleteOwnAccount, fetchAccountRemovalEligibility } from "./self-service";

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

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/me", { method: "DELETE" });
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
