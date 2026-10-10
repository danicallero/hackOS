import { screen } from "@testing-library/react-native";
import { Text } from "react-native";
import {
  ProfileAvatarCollapse,
  ProfileAvatarCollapseAnchor,
  type ProfileAvatarCollapseController,
} from "@/components/profile-avatar-collapse";
import {
  PROFILE_AVATAR_COLLAPSE_DISTANCE,
  profileAvatarCoverOpacity,
  profileAvatarMaskFrame,
  profileAvatarMorphPath,
  resolveProfileCameraTarget,
} from "@/lib/profile-avatar-collapse";
import { renderMobile } from "./render";

jest.mock("@/components/person-avatar", () => ({ useApiImage: () => null }));
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
    expect(collapsed.width).toBe(125.33);
    expect(collapsed.height).toBe(36.67);
    expect(collapsed.borderRadius).toBe(18.335);
    expect(collapsed.left).toBe(138.335);
    expect(collapsed.top).toBe(14);
    const descendingScrollFrames = [1, 0.75, 0.5, 0.25, 0].map((progress) =>
      profileAvatarMaskFrame(112, start, island, progress),
    );
    [125.33, 121.9975, 118.665, 115.3325, 112].forEach((width, index) => {
      expect(descendingScrollFrames[index].width).toBeCloseTo(width);
    });
    expect(descendingScrollFrames.at(-1)).toEqual(profileAvatarMaskFrame(112, start, island, 0));
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

describe("profile camera target fallbacks", () => {
  const base = {
    height: 852,
    manufacturer: "Apple",
    modelId: "iPhone15,2",
    modelName: "iPhone 15 Pro",
    platform: "ios",
    safeAreaTop: 59,
    screenWidth: 393,
    statusBarHeight: 0,
  };

  it("targets a Dynamic Island using model and safe-area geometry", () => {
    expect(resolveProfileCameraTarget(base)).toEqual({
      left: 134,
      top: expect.closeTo(11.33),
      width: 125,
      height: 36.67,
      hasCutout: true,
    });
  });

  it("matches the iPhone 16/17 Pro Dynamic Island frame to the screen metrics", () => {
    const target = resolveProfileCameraTarget({
      ...base,
      height: 874,
      modelId: "iPhone18,1",
      modelName: "iPhone 17 Pro",
      safeAreaTop: 62,
      screenWidth: 402,
    });
    expect(target.left).toBeCloseTo(138.335);
    expect(target.top).toBe(14);
    expect(target.width).toBe(125.33);
    expect(target.height).toBe(36.67);
    expect(target.hasCutout).toBe(true);
  });

  it("targets a notch on older iPhones", () => {
    expect(
      resolveProfileCameraTarget({
        ...base,
        modelId: "iPhone14,7",
        modelName: "iPhone 14",
        safeAreaTop: 47,
      }),
    ).toEqual({ left: 108.5, top: 0, width: 176, height: 34, hasCutout: true });
  });

  it("supports a centered Android punch-hole fallback and a compact no-cutout avatar", () => {
    const android = {
      ...base,
      manufacturer: "Google",
      modelId: null,
      modelName: "Pixel 8",
      platform: "android",
      safeAreaTop: 24,
      statusBarHeight: 24,
    };
    expect(resolveProfileCameraTarget(android)).toEqual({
      left: 184.5,
      top: 0,
      width: 24,
      height: 24,
      hasCutout: true,
    });
    expect(
      resolveProfileCameraTarget({
        ...android,
        modelName: "Pixel 3",
      }),
    ).toEqual({ left: 176.5, top: 30, width: 40, height: 40, hasCutout: false });
  });

  it("falls back below the safe area in landscape and accepts explicit OEM geometry", () => {
    expect(
      resolveProfileCameraTarget({
        ...base,
        height: 393,
        screenWidth: 852,
      }),
    ).toEqual({ left: 406, top: 65, width: 40, height: 40, hasCutout: false });
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
