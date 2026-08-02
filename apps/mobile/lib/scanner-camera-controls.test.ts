import { scannerCameraControls } from "./scanner-camera-controls";

describe("scanner camera controls", () => {
  it("keeps manual entry on the left and shows the torch when the camera supports it", () => {
    expect(scannerCameraControls(true)).toEqual({
      manualEntrySide: "left",
      showTorch: true,
    });
  });

  it("moves manual entry to the right and hides the torch when no torch exists", () => {
    expect(scannerCameraControls(false)).toEqual({
      manualEntrySide: "right",
      showTorch: false,
    });
  });
});
