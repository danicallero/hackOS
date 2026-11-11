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
});
