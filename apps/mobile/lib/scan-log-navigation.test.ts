import { SCAN_LOG_ROUTES } from "./scan-log-navigation";

describe("scan log navigation", () => {
  it("keeps history in the stack that opened it", () => {
    expect(SCAN_LOG_ROUTES.account).toBe("/(tabs)/others/scan-log");
    expect(SCAN_LOG_ROUTES.scanner).toBe("/(tabs)/scan/scan-log");
  });
});
