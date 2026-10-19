import {
  applyOrientationPolicy,
  LARGE_SCREEN_MIN_SIDE,
  orientationPolicy,
} from "./screen-orientation";

describe("orientation policy", () => {
  it("keeps phones and cover displays portrait and frees large displays", () => {
    expect(orientationPolicy({ width: 390, height: 844 })).toBe("portrait");
    expect(orientationPolicy({ width: 844, height: 390 })).toBe("portrait"); // phone in landscape
    expect(orientationPolicy({ width: 360, height: 780 })).toBe("portrait"); // cover display
    expect(orientationPolicy({ width: LARGE_SCREEN_MIN_SIDE, height: 900 })).toBe("any");
    expect(orientationPolicy({ width: 673, height: 841 })).toBe("any"); // Galaxy Z Fold inner
    expect(orientationPolicy({ width: 841, height: 700 })).toBe("any"); // Pixel Fold inner
    expect(orientationPolicy({ width: 1280, height: 800 })).toBe("any"); // tablet
    expect(orientationPolicy({ width: 466, height: 678 })).toBe("any"); // iPhone Duo outer
    expect(orientationPolicy({ width: 375, height: 667 })).toBe("portrait"); // compact phone
  });

  it("locks portrait or unlocks through the native module", async () => {
    const module = {
      OrientationLock: { PORTRAIT_UP: 3 },
      lockAsync: jest.fn().mockResolvedValue(undefined),
      unlockAsync: jest.fn().mockResolvedValue(undefined),
    };
    await applyOrientationPolicy("portrait", module);
    expect(module.lockAsync).toHaveBeenCalledWith(3);
    expect(module.unlockAsync).not.toHaveBeenCalled();
    await applyOrientationPolicy("any", module);
    expect(module.unlockAsync).toHaveBeenCalledTimes(1);
  });

  it("does nothing without the native module and swallows a refused lock", async () => {
    await expect(applyOrientationPolicy("portrait", null)).resolves.toBeUndefined();
    const refusing = {
      OrientationLock: { PORTRAIT_UP: 3 },
      lockAsync: jest.fn().mockRejectedValue(new Error("multi-window")),
      unlockAsync: jest.fn(),
    };
    await expect(applyOrientationPolicy("portrait", refusing)).resolves.toBeUndefined();
  });
});
