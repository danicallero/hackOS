export type ScannerCameraControls = {
  manualEntrySide: "left" | "right";
  showTorch: boolean;
};

export function scannerCameraControls(hasBackCameraTorch: boolean): ScannerCameraControls {
  return {
    manualEntrySide: hasBackCameraTorch ? "left" : "right",
    showTorch: hasBackCameraTorch,
  };
}
