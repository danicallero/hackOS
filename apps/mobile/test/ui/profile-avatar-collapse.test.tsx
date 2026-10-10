import { screen } from "@testing-library/react-native";
import { Text } from "react-native";
import {
  ProfileAvatarCollapse,
  ProfileAvatarCollapseAnchor,
  type ProfileAvatarCollapseController,
} from "@/components/profile-avatar-collapse";
import {
  PROFILE_AVATAR_COLLAPSE_DISTANCE,
  pickHolePunchCutout,
  profileAvatarCoverOpacity,
  profileAvatarMaskFrame,
  profileAvatarMorphPath,
  resolveProfileCameraTarget,
} from "@/lib/profile-avatar-collapse";
import { renderMobile } from "./render";

jest.mock("@/components/person-avatar", () => ({ useApiImage: () => null }));
jest.mock("@/modules/camera-capabilities", () => ({
  __esModule: true,
  default: { getDisplayCutoutRects: () => [] },
}));
jest.mock("@/lib/diary", () => ({ diaryInitials: () => "AH" }));
jest.mock("@react-native-masked-view/masked-view", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: ({
      children,
      maskElement,
      ...props
    }: {
      children: React.ReactNode;
      maskElement: React.ReactNode;
    }) => (
      <View {...props}>
        {maskElement}
        {children}
      </View>
    ),
  };
});

const start = { left: 100, top: 260, width: 112, height: 112 };
const island = {
  left: 138.335,
  top: 14,
  width: 125.33,
  height: 36.67,
  hasCutout: true,
};

describe("profile avatar collapse geometry", () => {
  it("maps 120 points of upward scroll to one reversible progress range", () => {
    expect(PROFILE_AVATAR_COLLAPSE_DISTANCE).toBe(120);
    expect(profileAvatarMaskFrame(112, start, island, 0)).toEqual({
      width: 112,
      height: 112,
      borderRadius: 56,
      left: 100,
      top: 260,
    });

    const halfway = profileAvatarMaskFrame(112, start, island, 0.5);
    expect(halfway.width).toBeCloseTo(118.665);
    expect(halfway.height).toBeCloseTo((112 + 36.67) / 2);
    expect(halfway.borderRadius).toBeCloseTo(halfway.height / 2);

    const collapsed = profileAvatarMaskFrame(112, start, island, 1);
    expect(collapsed.width).toBeCloseTo(125.33);
    expect(collapsed.height).toBeCloseTo(36.67);
    expect(collapsed.borderRadius).toBeCloseTo(18.335);
    expect(collapsed.left).toBeCloseTo(138.335);
    expect(collapsed.top).toBeCloseTo(14);
    const descendingScrollFrames = [1, 0.75, 0.5, 0.25, 0].map((progress) =>
      profileAvatarMaskFrame(112, start, island, progress),
    );
    [125.33, 121.9975, 118.665, 115.3325, 112].forEach((width, index) => {
      expect(descendingScrollFrames[index].width).toBeCloseTo(width);
    });
    expect(descendingScrollFrames.at(-1)).toEqual(profileAvatarMaskFrame(112, start, island, 0));
  });

  it("keeps the mask frame centred on the same line as the morph path for an off-center start", () => {
    const offCenter = { left: 20, top: 300, width: 112, height: 112 };
    const target = resolveProfileCameraTarget({
      height: 852,
      platform: "ios",
      safeAreaTop: 59,
      screenWidth: 393,
    });
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const frame = profileAvatarMaskFrame(112, offCenter, target, p);
      const expectedX = 76 + (target.left + target.width / 2 - 76) * p;
      const expectedY = 356 + (target.top + target.height / 2 - 356) * p;
      expect(frame.left + frame.width / 2).toBeCloseTo(expectedX);
      expect(frame.top + frame.height / 2).toBeCloseTo(expectedY);
    }
    const end = profileAvatarMaskFrame(112, offCenter, target, 1);
    expect(end.left + end.width / 2).toBeCloseTo(393 / 2);
  });

  it("never lets the island lip path exceed the target width", () => {
    const wide = { left: 0, top: 200, width: 200, height: 200 };
    const target = resolveProfileCameraTarget({
      height: 852,
      platform: "ios",
      safeAreaTop: 59,
      screenWidth: 393,
    });
    const path = profileAvatarMorphPath(200, wide, target, 0.6);
    const xs = [...path.matchAll(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(0);
    // Every coordinate sits within the target width around the travelling centre.
    const centerX = 100 + (target.left + target.width / 2 - 100) * 0.6;
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(centerX - target.width / 2 - 0.01);
    expect(Math.max(...xs)).toBeLessThanOrEqual(centerX + target.width / 2 + 0.01);
  });

  it("keeps every interpolated state circular or capsule-clipped", () => {
    for (let step = 0; step <= 20; step += 1) {
      const frame = profileAvatarMaskFrame(112, start, island, step / 20);
      expect(frame.borderRadius).toBeGreaterThanOrEqual(Math.min(frame.width, frame.height) / 2);
    }
  });

  it("uses a simple circular scale and position path when reduced motion is enabled", () => {
    const frame = profileAvatarMaskFrame(112, start, island, 1, true);
    expect(frame.width).toBeCloseTo(island.height);
    expect(frame.height).toBeCloseTo(island.height);
    expect(frame.borderRadius).toBeCloseTo(frame.height / 2);
    expect(profileAvatarCoverOpacity(1, true)).toBeCloseTo(0.7);
  });

  it("uses the original Telegram cubic paths throughout the transition", () => {
    const expanded = profileAvatarMorphPath(112, start, island, 0);
    const middle = profileAvatarMorphPath(112, start, island, 0.5);
    const collapsed = profileAvatarMorphPath(112, start, island, 1);
    expect(expanded).toContain("C ");
    expect(expanded).not.toContain(" L ");
    expect(middle).toContain(" C ");
    expect(collapsed).toBe("");
    expect(profileAvatarMorphPath(112, start, island, 0.5)).toBe(middle);
    expect(profileAvatarMorphPath(112, start, island, 0.5, true)).not.toContain(" C ");
  });

  it("uses the Telegram fade and cover progress curves", () => {
    expect(profileAvatarCoverOpacity(0)).toBe(0);
    expect(profileAvatarCoverOpacity(0.5)).toBeCloseTo(0.525);
    expect(profileAvatarCoverOpacity(1)).toBe(1);
  });
});

describe("profile camera target", () => {
  const base = {
    height: 852,
    platform: "ios",
    safeAreaTop: 59,
    screenWidth: 393,
  };
  const plain = (left: number, top: number) => ({
    left,
    top,
    width: 40,
    height: 40,
    hasCutout: false,
  });

  // Hardware island: 126 x 37.33 pt, top = safe-area inset - 48.
  const insideIsland = (
    target: { left: number; top: number; width: number; height: number },
    screenWidth: number,
    safeAreaTop: number,
  ) => {
    const islandLeft = (screenWidth - 126) / 2;
    const islandTop = safeAreaTop - 48;
    expect(target.left).toBeGreaterThan(islandLeft);
    expect(target.left + target.width).toBeLessThan(islandLeft + 126);
    expect(target.top).toBeGreaterThan(islandTop);
    expect(target.top + target.height).toBeLessThan(islandTop + 37.33);
    expect(target.left + target.width / 2).toBeCloseTo(screenWidth / 2);
    expect(target.top + target.height / 2).toBeCloseTo(islandTop + 37.33 / 2);
  };

  it("targets a Dynamic Island on 393 pt devices, inside the hardware island", () => {
    const target = resolveProfileCameraTarget(base);
    expect(target.hasCutout).toBe(true);
    expect(target.top).toBeCloseTo(12);
    insideIsland(target, 393, 59);
  });

  it("targets the iPhone 16/17 Pro island on 402 pt devices, inside the hardware island", () => {
    const target = resolveProfileCameraTarget({
      ...base,
      height: 874,
      safeAreaTop: 62,
      screenWidth: 402,
    });
    expect(target.top).toBeCloseTo(15);
    expect(target.hasCutout).toBe(true);
    insideIsland(target, 402, 62);
  });

  it("targets Plus/Max widths (430, 440) inside the island", () => {
    insideIsland(
      resolveProfileCameraTarget({ ...base, height: 932, safeAreaTop: 59, screenWidth: 430 }),
      430,
      59,
    );
    insideIsland(
      resolveProfileCameraTarget({ ...base, height: 956, safeAreaTop: 62, screenWidth: 440 }),
      440,
      62,
    );
  });

  it("does not morph on notch iPhones or iPhones without a cutout", () => {
    expect(resolveProfileCameraTarget({ ...base, safeAreaTop: 47 })).toEqual(plain(176.5, 53));
    expect(resolveProfileCameraTarget({ ...base, safeAreaTop: 20 })).toEqual(plain(176.5, 26));
  });

  describe("android", () => {
    const android = { ...base, platform: "android", safeAreaTop: 32, screenWidth: 400 };

    it("morphs into the real centered hole punch", () => {
      expect(
        resolveProfileCameraTarget({
          ...android,
          displayCutoutRects: [{ left: 189, top: 10, width: 22, height: 22 }],
        }),
      ).toEqual({ left: 189, top: 10, width: 22, height: 22, hasCutout: true });
    });

    it("morphs into an off-center (left) hole punch", () => {
      expect(
        resolveProfileCameraTarget({
          ...android,
          displayCutoutRects: [{ left: 36, top: 12, width: 20, height: 20 }],
        }),
      ).toEqual({ left: 36, top: 12, width: 20, height: 20, hasCutout: true });
    });

    it("skips wide notches, side cutouts and malformed rects", () => {
      for (const rect of [
        { left: 120, top: 0, width: 160, height: 34 },
        { left: 0, top: 150, width: 30, height: 30 },
        { left: 390, top: 8, width: 30, height: 30 },
        { left: 100, top: 8, width: 0, height: 0 },
      ]) {
        expect(
          resolveProfileCameraTarget({ ...android, displayCutoutRects: [rect] }).hasCutout,
        ).toBe(false);
      }
    });

    it("uses the plain collapse without a cutout, rects, API 28 or the native module", () => {
      const expected = plain(180, 38);
      expect(resolveProfileCameraTarget({ ...android, displayCutoutRects: [] })).toEqual(expected);
      expect(resolveProfileCameraTarget({ ...android, displayCutoutRects: null })).toEqual(
        expected,
      );
      expect(resolveProfileCameraTarget(android)).toEqual(expected);
    });

    it("prefers the topmost narrow rect", () => {
      expect(
        pickHolePunchCutout(
          [
            { left: 100, top: 40, width: 20, height: 20 },
            { left: 190, top: 8, width: 20, height: 20 },
          ],
          400,
        ),
      ).toEqual({ left: 190, top: 8, width: 20, height: 20 });
    });

    it("morphs into a circle centred in a padded or oval cutout", () => {
      expect(pickHolePunchCutout([{ left: 180, top: 6, width: 40, height: 24 }], 400)).toEqual({
        left: 188,
        top: 6,
        width: 24,
        height: 24,
      });
    });
  });

  it("falls back below the safe area in landscape and accepts explicit OEM geometry", () => {
    expect(resolveProfileCameraTarget({ ...base, height: 393, screenWidth: 852 })).toEqual(
      plain(406, 65),
    );
    expect(
      resolveProfileCameraTarget({
        ...base,
        platform: "android",
        height: 393,
        screenWidth: 852,
        displayCutoutRects: [{ left: 0, top: 150, width: 30, height: 30 }],
      }).hasCutout,
    ).toBe(false);
    expect(
      resolveProfileCameraTarget({
        ...base,
        cameraCutoutFrame: { left: 140, top: 8, width: 110, height: 30 },
      }),
    ).toEqual({ left: 140, top: 8, width: 110, height: 30, hasCutout: true });
  });
});

describe("profile avatar placeholder", () => {
  it("keeps the original expanded avatar visible after measuring the overlay", async () => {
    const controller = {
      anchorFrame: start,
      scrollOffset: { value: 0 },
      anchorRef: { current: null },
      onAnchorLayout: () => {},
    } as unknown as ProfileAvatarCollapseController;
    await renderMobile(
      <ProfileAvatarCollapseAnchor controller={controller} size={96}>
        <Text>AH</Text>
      </ProfileAvatarCollapseAnchor>,
    );
    expect(screen.getByText("AH", { includeHiddenElements: true })).toBeTruthy();
  });

  it("keeps the account initials visible when no photo exists", async () => {
    const controller = {
      anchorFrame: { left: 100, top: 220, width: 96, height: 96 },
      hostOrigin: { x: 0, y: 0 },
      scrollOffset: { value: 0 },
    } as ProfileAvatarCollapseController;

    await renderMobile(
      <ProfileAvatarCollapse
        controller={controller}
        image={null}
        name="Admin HackOS"
        size={96}
        variant="account"
      />,
    );

    expect(
      screen.getByTestId("profile-avatar-collapse-mask", { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByText("AH", { includeHiddenElements: true })).toBeTruthy();
  });
});
