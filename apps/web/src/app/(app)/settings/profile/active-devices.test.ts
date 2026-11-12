import { describe, expect, it } from "vitest";
import { deviceName } from "./active-devices";

describe("deviceName", () => {
  it("names the browser and system", () => {
    expect(
      deviceName(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe("Safari · macOS");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36")).toBe(
      "Chrome · Windows",
    );
    expect(deviceName(null)).toBe("");
  });

  it("names the phone the app is signed in on", () => {
    expect(deviceName("hackOS/42 (iPhone 15 Pro; iOS 18.1)")).toBe("hackOS app · iPhone 15 Pro");
    expect(deviceName("hackOS (samsung SM-G991B; Android 14)")).toBe(
      "hackOS app · samsung SM-G991B",
    );
    // Builds that predate the app's own user-agent.
    expect(deviceName("Expo/1017756 CFNetwork/1568.200.51 Darwin/24.1.0")).toBe("hackOS app");
  });
});
