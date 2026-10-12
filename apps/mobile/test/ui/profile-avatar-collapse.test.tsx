import { act, renderHook, screen } from "@testing-library/react-native";
import { Platform, StyleSheet, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  ProfileAvatarCollapse,
  ProfileAvatarCollapseAnchor,
  type ProfileAvatarCollapseController,
  useProfileAvatarCollapse,
} from "@/components/profile-avatar-collapse";
import {
  PROFILE_AVATAR_COLLAPSE_DISTANCE,
  PROFILE_AVATAR_MERGE_PROGRESS,
  PROFILE_AVATAR_SIMPLE_MIN_SCALE,
  PROFILE_GOOEY_FADE_START,
  PROFILE_GOOEY_SHRINK_END,
  pickHolePunchCutout,
  profileAvatarBlobBounds,
  profileAvatarCarry,
  profileAvatarCarryDistance,
  profileAvatarContentFrame,
  profileAvatarContentRadii,
  profileAvatarCoverOpacity,
  profileAvatarMaskFrame,
  profileAvatarMinContentHeight,
  profileAvatarMorphPath,
  profileAvatarRestingOffsetBound,
  profileAvatarSimpleReleaseOffset,
  profileAvatarSimpleTransform,
  profileAvatarSnapDirection,
  profileAvatarSnapOffset,
  profileAvatarSnapTarget,
  profileGooeyEndDiameter,
  profileGooeyEndOffset,
  profileGooeyEndScale,
  profileGooeyFrame,
  profileGooeyProgress,
  resolveProfileCameraTarget,
} from "@/lib/profile-avatar-collapse";
import { renderMobile } from "./render";

jest.mock("@/components/person-avatar", () => ({ useApiImage: () => null }));
// Expose the scroll worklets as plain callbacks so a drag can be replayed.
jest.mock("react-native-reanimated", () => ({
  ...require("react-native-reanimated/mock"),
  useReducedMotion: () => false,
  useAnimatedScrollHandler: (handlers: unknown) => handlers,
}));
const mockHaptic = jest.fn();
jest.mock("@/lib/haptics", () => ({ haptic: (intent: string) => mockHaptic(intent) }));
let mockCutoutRects: { left: number; top: number; width: number; height: number }[] = [];
jest.mock("@/modules/camera-capabilities", () => ({
  __esModule: true,
  default: { getDisplayCutoutRects: () => mockCutoutRects },
}));
jest.mock("@/modules/profile-gooey", () => {
  const { View } = require("react-native");
  return { ProfileGooeyView: (props: object) => <View {...props} /> };
});
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

  it("keeps the island lip inside the straight run of the island's lower edge", () => {
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
    // Past the straight run the island's corners curve up; the lip (bezier
    // handles included) must not reach into them (#935).
    const centerX = 100 + (target.left + target.width / 2 - 100) * 0.6;
    const straight = (target.width - target.height) / 2;
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(centerX - straight - 0.01);
    expect(Math.max(...xs)).toBeLessThanOrEqual(centerX + straight + 0.01);
  });

  it("keeps the image covering the mask blob while it rises (#935)", () => {
    for (let step = 0; step <= 28; step += 1) {
      const progress = step / 100;
      const blob = profileAvatarBlobBounds(112, start, island, progress);
      const image = profileAvatarContentFrame(112, start, island, progress);
      if (!blob) continue;
      expect(image.top).toBeLessThanOrEqual(blob.top + 0.01);
      expect(image.left).toBeLessThanOrEqual(blob.left + 0.01);
      expect(image.left + image.width).toBeGreaterThanOrEqual(blob.left + blob.width - 0.01);
      expect(image.top + image.height).toBeGreaterThanOrEqual(blob.top + blob.height - 0.01);
      // Square around the blob: centred on it horizontally.
      expect(image.left + image.width / 2).toBeCloseTo(blob.left + blob.width / 2, 0);
    }
  });

  it("keeps the photo centred on the blob for an avatar far below the island (#935)", () => {
    // A person profile under a native header starts ~30 pt lower than Account,
    // so the linear mask frame trails below the clip.
    for (const low of [start, { ...start, top: start.top + 40 }]) {
      for (let step = 0; step <= 28; step += 1) {
        const progress = step / 100;
        const blob = profileAvatarBlobBounds(112, low, island, progress);
        const image = profileAvatarContentFrame(112, low, island, progress);
        if (!blob) continue;
        const half = Math.max(blob.width, blob.height) / 2;
        // Never extended below the blob's square, so the neck alone adds height.
        expect(image.top + image.height).toBeCloseTo(blob.top + blob.height / 2 + half, 3);
        expect(image.left + image.width / 2).toBeCloseTo(blob.left + blob.width / 2, 3);
        if (progress <= 0.15) {
          expect(image.top + image.height / 2).toBeCloseTo(blob.top + blob.height / 2, 3);
        }
      }
    }
  });

  it("eases the image into the island after the blob ends, without jumps", () => {
    // Around the blob's end (progress 153/540) the square hands over smoothly.
    let previous = profileAvatarContentFrame(112, start, island, 0.27);
    for (let progress = 0.271; progress <= 0.3; progress += 0.001) {
      const frame = profileAvatarContentFrame(112, start, island, progress);
      expect(Math.abs(frame.top - previous.top)).toBeLessThan(2);
      expect(Math.abs(frame.left - previous.left)).toBeLessThan(2);
      expect(Math.abs(frame.width - previous.width)).toBeLessThan(2);
      previous = frame;
    }
    const end = profileAvatarContentFrame(112, start, island, 1);
    expect(end.left + end.width / 2).toBeCloseTo(island.left + island.width / 2, 3);
    expect(end.top + end.height).toBeCloseTo(island.top + island.height, 3);
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

/** Points along every cubic of a morph path, sampled 16 times per segment. */
function morphPathPoints(path: string) {
  const points: [number, number][] = [];
  let current: [number, number] = [0, 0];
  for (const command of path.split(/(?=[MCZ])/)) {
    const v = command.slice(1).trim().split(/\s+/).filter(Boolean).map(Number);
    if (command.startsWith("M")) current = [v[0], v[1]];
    if (!command.startsWith("C")) continue;
    for (let k = 0; k <= 16; k++) {
      const u = k / 16;
      const w = 1 - u;
      const at = (a: number, b: number, c: number, d: number) =>
        w * w * w * a + 3 * w * w * u * b + 3 * w * u * u * c + u * u * u * d;
      points.push([at(current[0], v[0], v[2], v[4]), at(current[1], v[1], v[3], v[5])]);
    }
    current = [v[4], v[5]];
  }
  return points;
}

describe("profile avatar image clip (#935)", () => {
  const target = resolveProfileCameraTarget({
    height: 852,
    platform: "ios",
    safeAreaTop: 59,
    screenWidth: 393,
  });

  it("is the mask's own circle, at the mask's size, from the first frame of the morph", () => {
    for (const from of [start, { ...start, top: 180 }]) {
      const expanded = profileAvatarContentFrame(112, from, target, 0);
      expect(expanded).toEqual({ left: from.left, top: from.top, width: 112, height: 112 });
      expect(profileAvatarContentRadii(expanded, 0)).toEqual({
        borderTopLeftRadius: 56,
        borderTopRightRadius: 56,
        borderBottomLeftRadius: 56,
        borderBottomRightRadius: 56,
      });
      for (let step = 0; step <= 30; step += 1) {
        const progress = step / 200;
        const image = profileAvatarContentFrame(112, from, target, progress);
        const radius = image.width / 2;
        // A square frame, cut to its inscribed circle on every corner.
        expect(image.height).toBeCloseTo(image.width, 6);
        for (const corner of Object.values(profileAvatarContentRadii(image, progress)))
          expect(corner).toBeCloseTo(radius, 6);
        // The mask is that same circle: same size, same centre.
        const blob = profileAvatarBlobBounds(112, from, target, progress);
        expect(blob?.height).toBeCloseTo(image.height, 1);
        const cx = image.left + radius;
        const cy = image.top + radius;
        const distances = morphPathPoints(profileAvatarMorphPath(112, from, target, progress)).map(
          ([x, y]) => Math.hypot(x - cx, y - cy),
        );
        expect(Math.max(...distances)).toBeCloseTo(radius, 1);
      }
    }
  });

  it("straightens only its top corners as the neck reaches for the camera", () => {
    const image = profileAvatarContentFrame(112, start, target, 0.5);
    const radii = profileAvatarContentRadii(image, 0.5);
    expect(radii.borderTopLeftRadius).toBe(0);
    expect(radii.borderTopRightRadius).toBe(0);
    expect(radii.borderBottomLeftRadius).toBeCloseTo(Math.min(image.width, image.height) / 2, 6);
    expect(radii.borderBottomRightRadius).toBe(radii.borderBottomLeftRadius);
  });
});

describe("profile avatar carry before the morph (#935)", () => {
  const target = resolveProfileCameraTarget({
    height: 852,
    platform: "ios",
    safeAreaTop: 59,
    screenWidth: 393,
  });
  const far = { left: 140, top: 300, width: 112, height: 112 };
  // The Telegram mask starts with the avatar centre 234/300 of its size below
  // the island's lower edge.
  const morphStartY = target.top + target.height + (234 * 112) / 300;

  it("rides a far avatar up to where the morph starts", () => {
    const carry = profileAvatarCarryDistance(112, far, target);
    expect(carry).toBeCloseTo(far.top + 56 - morphStartY, 6);
    expect(profileAvatarCarryDistance(112, { ...far, top: morphStartY - 56 - 10 }, target)).toBe(0);
    expect(profileAvatarCarry(-5, carry, 120)).toEqual({ shift: 0, progress: 0 });
    expect(profileAvatarCarry(carry / 2, carry, 120)).toEqual({ shift: carry / 2, progress: 0 });
    expect(profileAvatarCarry(carry + 60, carry, 120)).toEqual({ shift: carry, progress: 0.5 });
    expect(profileAvatarCarry(carry + 500, carry, 120)).toEqual({ shift: carry, progress: 1 });
  });

  it("keeps pace with the text until the merge, then starts the morph without a jump", () => {
    const carry = profileAvatarCarryDistance(112, far, target);
    const centreAt = (offset: number) => {
      const { shift, progress } = profileAvatarCarry(offset, carry, 120);
      const from = { ...far, top: far.top - shift };
      const blob = profileAvatarBlobBounds(112, from, target, progress);
      if (!blob) throw new Error("blob ended");
      return blob.top + blob.height / 2;
    };
    let previous = centreAt(0);
    expect(previous).toBeCloseTo(far.top + 56, 6);
    for (let offset = 1; offset <= Math.ceil(carry) + 12; offset += 1) {
      const centre = centreAt(offset);
      // One point per scrolled point during the carry, at most a little more
      // as the blob starts rising into the neck.
      if (offset <= carry) expect(previous - centre).toBeCloseTo(1, 6);
      else expect(previous - centre).toBeLessThan(1.5);
      previous = centre;
    }
  });
});

describe("profile avatar snap (#935)", () => {
  const distance = PROFILE_AVATAR_COLLAPSE_DISTANCE;

  it("leaves offsets outside the collapse range alone", () => {
    expect(profileAvatarSnapTarget(0, 0, distance)).toBeNull();
    expect(profileAvatarSnapTarget(-40, -1, distance)).toBeNull();
    expect(profileAvatarSnapTarget(distance, 0, distance)).toBeNull();
    expect(profileAvatarSnapTarget(distance + 300, 2, distance)).toBeNull();
  });

  it("collapses on any upward release and expands on any downward one", () => {
    // Up even 10% into the range collapses; down even at 90% expands.
    expect(profileAvatarSnapTarget(distance * 0.1, 1, distance)).toBe(distance);
    expect(profileAvatarSnapTarget(distance * 0.9, -1, distance)).toBe(0);
    expect(profileAvatarSnapTarget(distance * 0.9, 1, distance)).toBe(distance);
    expect(profileAvatarSnapTarget(distance * 0.1, -1, distance)).toBe(0);
  });

  it("falls back to the nearer rest only with no movement", () => {
    expect(profileAvatarSnapTarget(10, 0, distance)).toBe(0);
    expect(profileAvatarSnapTarget(distance / 2 - 1, 0, distance)).toBe(0);
    expect(profileAvatarSnapTarget(distance / 2, 0, distance)).toBe(distance);
    expect(profileAvatarSnapTarget(distance - 10, 0, distance)).toBe(distance);
  });

  it("takes the direction from the last scroll delta, then the release velocity", () => {
    expect(profileAvatarSnapDirection(3, -2, "ios")).toBe(1);
    expect(profileAvatarSnapDirection(-0.5, 2, "android")).toBe(-1);
    expect(profileAvatarSnapDirection(0, 0.6, "ios")).toBe(1);
    // Android reports the finger's velocity, opposite to the offset's.
    expect(profileAvatarSnapDirection(0, 0.6, "android")).toBe(-1);
    expect(profileAvatarSnapDirection(0, 0.01, "ios")).toBe(0);
    expect(profileAvatarSnapDirection(0, 0, "android")).toBe(0);
  });

  it("takes the distance explicitly, with no worklet default parameter", () => {
    // A worklet's default-parameter expression is not captured on the UI thread.
    expect(profileAvatarSnapTarget.length).toBe(3);
    expect(profileAvatarSnapTarget.toString()).not.toContain("PROFILE_AVATAR_COLLAPSE_DISTANCE");
  });

  it("measures snap targets from the true top under an automatic inset", () => {
    const resting = -59;
    // y 0 is 59 pt past the true top: inside the morph, so it is not a rest.
    expect(profileAvatarSnapOffset(0, resting, 0, distance, Infinity)).toBe(resting);
    expect(profileAvatarSnapOffset(10, resting, 0, distance, Infinity)).toBe(resting + distance);
    expect(profileAvatarSnapOffset(-20, resting, 0, distance, Infinity)).toBe(resting);
    expect(profileAvatarSnapOffset(-50, resting, 1, distance, Infinity)).toBe(resting + distance);
    expect(profileAvatarSnapOffset(55, resting, -1, distance, Infinity)).toBe(resting);
    // Exactly two rests: the true top and the collapsed offset.
    expect(profileAvatarSnapOffset(resting, resting, 0, distance, Infinity)).toBeNull();
    expect(profileAvatarSnapOffset(resting + distance, resting, 0, distance, Infinity)).toBeNull();
    expect(profileAvatarSnapOffset(-80, resting, 0, distance, Infinity)).toBeNull();
  });

  it("expands instead of collapsing past the end of a short page", () => {
    // The content only scrolls 40 pt past y 0: the collapsed rest (61) is unreachable.
    expect(profileAvatarSnapOffset(-40, -59, 1, distance, 40)).toBe(-59);
    expect(profileAvatarSnapOffset(-40, -59, -1, distance, 40)).toBe(-59);
    expect(profileAvatarSnapOffset(-40, -59, 1, distance, 61)).toBe(61);
  });

  it("bounds the iOS true top by the status-bar overlap of the scroll host", () => {
    expect(profileAvatarRestingOffsetBound(59, 0)).toBe(-59);
    expect(profileAvatarRestingOffsetBound(59, 20)).toBe(-39);
    expect(profileAvatarRestingOffsetBound(59, 120)).toBe(-0);
  });

  it("adds a shown native header to the iOS true top", () => {
    // Transparent header: status bar plus navigation bar above y 0.
    expect(profileAvatarRestingOffsetBound(59, 0, 103)).toBe(-103);
    expect(profileAvatarRestingOffsetBound(59, 0, 0)).toBe(-59);
  });

  it("keeps a short page tall enough to reach both rests", () => {
    // 852 pt viewport: the status-bar bound needs 61 pt of scroll past y 0.
    const min = profileAvatarMinContentHeight(852, -59, distance);
    expect(min).toBe(913);
    const maxOffset = min - 852;
    // Under a header (true top -103) the morph's first frames already collapse.
    expect(profileAvatarSnapOffset(-98, -103, 1, distance, maxOffset)).toBe(-103 + distance);
    expect(profileAvatarSnapOffset(-98, -103, -1, distance, maxOffset)).toBe(-103);
    // Without the iOS inset (Android), the full distance.
    expect(profileAvatarMinContentHeight(800, 0, distance)).toBe(920);
  });

  it("snaps only inside the morph, after the carry", () => {
    expect(profileAvatarSnapTarget(20, 1, 120, 40)).toBeNull();
    expect(profileAvatarSnapTarget(40, 1, 120, 40)).toBeNull();
    expect(profileAvatarSnapTarget(50, 1, 120, 40)).toBe(160);
    expect(profileAvatarSnapTarget(150, -1, 120, 40)).toBe(40);
    expect(profileAvatarSnapTarget(80, 0, 120, 40)).toBe(40);
    expect(profileAvatarSnapTarget(120, 0, 120, 40)).toBe(160);
    expect(profileAvatarSnapOffset(-40, -62, 1, 120, 500, 40)).toBeNull();
    expect(profileAvatarSnapOffset(-12, -62, 1, 120, 500, 40)).toBe(98);
    // A page too short for the collapsed rest settles where the morph starts.
    expect(profileAvatarSnapOffset(-12, -62, 1, 120, 60, 40)).toBe(-22);
  });

  it("honours a custom collapse distance", () => {
    expect(profileAvatarSnapTarget(60, 0, 80)).toBe(80);
    expect(profileAvatarSnapTarget(30, 0, 80)).toBe(0);
    expect(profileAvatarSnapTarget(90, 0, 80)).toBeNull();
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
      simple: false,
      target: island,
    } as unknown as ProfileAvatarCollapseController;

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

  describe("handover after the carry", () => {
    const controllerAt = (offset: number) =>
      ({
        anchorFrame: { left: 100, top: 300, width: 96, height: 96 },
        anchorRef: { current: null },
        carryDistance: 40,
        hostOrigin: { x: 0, y: 0 },
        onAnchorLayout: () => {},
        scrollOffset: { value: offset },
        simple: false,
        target: island,
      }) as unknown as ProfileAvatarCollapseController;
    const render = async (offset: number) =>
      renderMobile(
        <>
          <ProfileAvatarCollapseAnchor controller={controllerAt(offset)} size={96}>
            <Text testID="anchor-photo">AH</Text>
          </ProfileAvatarCollapseAnchor>
          <ProfileAvatarCollapse
            controller={controllerAt(offset)}
            image={null}
            name="Admin HackOS"
            size={96}
            variant="account"
          />
        </>,
      );
    const anchorOpacity = () =>
      StyleSheet.flatten(
        screen.getByTestId("anchor-photo", { includeHiddenElements: true }).parent?.props.style,
      ).opacity;
    const maskOpacity = () =>
      StyleSheet.flatten(
        screen.getByTestId("profile-avatar-collapse-mask", { includeHiddenElements: true }).props
          .style,
      ).opacity;

    it("keeps the in-content avatar while it rides with the content", async () => {
      await render(30);
      expect(anchorOpacity()).toBe(1);
      expect(maskOpacity()).toBe(0);
    });

    it("hands over to the mask once the morph starts", async () => {
      await render(41);
      expect(anchorOpacity()).toBe(0);
      expect(maskOpacity()).toBe(1);
    });
  });
});

describe("profile avatar anchor measurement (#935)", () => {
  afterEach(() => jest.useRealTimers());

  it("drops a measurement taken while the scroll moves and remeasures once it holds still", async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => useProfileAvatarCollapse(), {
      wrapper: ({ children }) => (
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 393, height: 852 },
            insets: { top: 59, left: 0, right: 0, bottom: 34 },
          }}
        >
          {children}
        </SafeAreaProvider>
      ),
    });
    const controller = result.current;
    // Window position of the avatar for the scroll offset the shadow tree saw.
    let anchorY = 300;
    const scrollTo = (offset: number) => {
      controller.scrollOffset.value = offset;
      anchorY = 300 - offset;
    };
    let moveDuringMeasurement = true;
    Object.assign(controller.hostRef, {
      current: { measureInWindow: (cb: (x: number, y: number) => void) => cb(0, 0) },
    });
    Object.assign(controller.anchorRef, {
      current: {
        measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => {
          const measuredY = anchorY;
          // A programmatic scroll lands between the native measurement and the callback.
          if (moveDuringMeasurement) {
            moveDuringMeasurement = false;
            scrollTo(150);
          }
          cb(100, measuredY, 96, 96);
        },
      },
    });

    await act(async () => {
      controller.onScrollBeginDrag();
      jest.advanceTimersByTime(200);
    });

    // The stale result (y 300 + offset 150) is dropped; the settled one maps back to 300.
    expect(result.current.anchorFrame).toEqual({ left: 100, top: 300, width: 96, height: 96 });
  });
});

type ScrollHandlers = Record<
  "onBeginDrag" | "onScroll" | "onEndDrag" | "onMomentumEnd",
  (event: { contentOffset: { x: number; y: number }; velocity?: { x: number; y: number } }) => void
>;

describe("profile avatar snap on release (#935)", () => {
  const event = (y: number, velocity = 0) => ({
    contentOffset: { x: 0, y },
    velocity: { x: 0, y: velocity },
  });

  async function setup() {
    // A Dynamic Island iPhone: the morph (and so the snap) runs.
    const { result } = await renderHook(() => useProfileAvatarCollapse(), {
      wrapper: ({ children }) => (
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 393, height: 852 },
            insets: { top: 59, left: 0, right: 0, bottom: 34 },
          }}
        >
          {children}
        </SafeAreaProvider>
      ),
    });
    const scrollTo = jest.fn();
    Object.assign(result.current.scrollRef, { current: { scrollTo } });
    const handlers = result.current.onScroll as unknown as ScrollHandlers;
    const drag = (start: number, ...moves: number[]) => {
      handlers.onBeginDrag(event(start));
      for (const y of moves) handlers.onScroll(event(y));
    };
    return { controller: result.current, handlers, drag, scrollTo };
  }

  beforeEach(() => mockHaptic.mockClear());

  it("collapses an upward release 10% into the range", async () => {
    const { handlers, drag, scrollTo } = await setup();
    drag(0, 6, 12);
    handlers.onEndDrag(event(12));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ animated: true, y: PROFILE_AVATAR_COLLAPSE_DISTANCE });
    // The release itself does not tap; the snap's own scroll and momentum end
    // do not re-snap.
    expect(mockHaptic).not.toHaveBeenCalled();
    handlers.onScroll(event(PROFILE_AVATAR_COLLAPSE_DISTANCE));
    handlers.onMomentumEnd(event(PROFILE_AVATAR_COLLAPSE_DISTANCE));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("taps once, medium, when the photo starts merging into the island", async () => {
    const { handlers, drag } = await setup();
    const merge = PROFILE_AVATAR_COLLAPSE_DISTANCE * PROFILE_AVATAR_MERGE_PROGRESS;
    drag(0, merge - 4);
    expect(mockHaptic).not.toHaveBeenCalled();
    handlers.onScroll(event(merge + 2));
    handlers.onScroll(event(merge + 20));
    expect(mockHaptic).toHaveBeenCalledTimes(1);
    expect(mockHaptic).toHaveBeenCalledWith("medium");
    // Coming back down does not tap; reaching the island again does.
    handlers.onScroll(event(merge - 10));
    expect(mockHaptic).toHaveBeenCalledTimes(1);
    handlers.onScroll(event(merge + 1));
    expect(mockHaptic).toHaveBeenCalledTimes(2);
  });

  it("taps once as a collapsed avatar starts stretching back out", async () => {
    const { handlers, drag } = await setup();
    const collapsed = PROFILE_AVATAR_COLLAPSE_DISTANCE;
    drag(collapsed + 40, collapsed + 10, collapsed);
    mockHaptic.mockClear();
    // Jitter at the rest is not a pull.
    handlers.onScroll(event(collapsed - 1.5));
    handlers.onScroll(event(collapsed));
    expect(mockHaptic).not.toHaveBeenCalled();
    handlers.onScroll(event(collapsed - 5));
    handlers.onScroll(event(collapsed - 20));
    expect(mockHaptic).toHaveBeenCalledTimes(1);
    expect(mockHaptic).toHaveBeenCalledWith("medium");
  });

  it("still taps when the snap settled a fraction short of the collapsed rest", async () => {
    const { handlers, drag } = await setup();
    const collapsed = PROFILE_AVATAR_COLLAPSE_DISTANCE;
    drag(collapsed - 30, collapsed - 0.4);
    mockHaptic.mockClear();
    handlers.onScroll(event(collapsed - 6));
    expect(mockHaptic).toHaveBeenCalledTimes(1);
  });

  it("expands a downward release 90% into the range", async () => {
    const { handlers, drag, scrollTo } = await setup();
    drag(200, 120, 112, 108);
    const taps = mockHaptic.mock.calls.length;
    handlers.onEndDrag(event(108));
    expect(scrollTo).toHaveBeenCalledWith({ animated: true, y: 0 });
    expect(mockHaptic).toHaveBeenCalledTimes(taps);
  });

  it("follows the momentum's own direction when it ends inside the range", async () => {
    const { handlers, drag, scrollTo } = await setup();
    drag(200, 150);
    handlers.onEndDrag(event(150, -1.2));
    expect(scrollTo).not.toHaveBeenCalled();
    handlers.onScroll(event(100));
    handlers.onScroll(event(90));
    const taps = mockHaptic.mock.calls.length;
    handlers.onMomentumEnd(event(90));
    expect(scrollTo).toHaveBeenCalledWith({ animated: true, y: 0 });
    expect(mockHaptic).toHaveBeenCalledTimes(taps);
  });

  it("measures the snap from a non-zero true top", async () => {
    const { handlers, drag, scrollTo } = await setup();
    // The automatic inset's first scroll event, before any drag.
    handlers.onScroll(event(-59));
    drag(-59, -50, -40);
    handlers.onEndDrag(event(-40));
    expect(scrollTo).toHaveBeenCalledWith({
      animated: true,
      y: -59 + PROFILE_AVATAR_COLLAPSE_DISTANCE,
    });
  });

  it("falls back to the nearer rest for a release with no movement", async () => {
    const { handlers, scrollTo } = await setup();
    handlers.onScroll(event(80));
    handlers.onBeginDrag(event(80));
    handlers.onEndDrag(event(80));
    expect(scrollTo).toHaveBeenCalledWith({ animated: true, y: PROFILE_AVATAR_COLLAPSE_DISTANCE });
  });

  it("never snaps or taps for programmatic scrolls short of the island", async () => {
    jest.useFakeTimers();
    const { controller, handlers, scrollTo } = await setup();
    handlers.onScroll(event(10));
    handlers.onScroll(event(20));
    handlers.onMomentumEnd(event(20));
    expect(scrollTo).not.toHaveBeenCalled();
    // The focus correction still moves to a rest, silently.
    controller.settleAtRest();
    jest.advanceTimersByTime(50);
    expect(scrollTo).toHaveBeenCalledWith({ animated: false, y: 0 });
    expect(mockHaptic).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe("profile avatar snap under a native header (#935)", () => {
  afterEach(() => jest.useRealTimers());

  it("seeds the header's true top and collapses a short page from the first frames", async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(
      () => useProfileAvatarCollapse(undefined, { headerHeight: 103 }),
      {
        wrapper: ({ children }) => (
          <SafeAreaProvider
            initialMetrics={{
              frame: { x: 0, y: 0, width: 393, height: 852 },
              insets: { top: 59, left: 0, right: 0, bottom: 34 },
            }}
          >
            {children}
          </SafeAreaProvider>
        ),
      },
    );
    const scrollTo = jest.fn();
    Object.assign(result.current.scrollRef, { current: { scrollTo } });
    Object.assign(result.current.hostRef, {
      current: { measureInWindow: (cb: (x: number, y: number) => void) => cb(0, 0) },
    });
    Object.assign(result.current.anchorRef, {
      current: {
        measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
          cb(140, 111, 112, 112),
      },
    });
    await act(async () => {
      result.current.onHostLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } },
      } as never);
      jest.advanceTimersByTime(1000);
    });
    // The avatar sits far below the island, so it rides up with the content
    // before the morph starts; the floor keeps the page scrollable past both.
    const carryFor = (anchor: typeof start | null) =>
      profileAvatarCarryDistance(
        112,
        anchor as typeof start,
        resolveProfileCameraTarget({
          height: 852,
          platform: "ios",
          safeAreaTop: 59,
          screenWidth: 393,
        }),
      );
    expect(result.current.carryDistance).toBeGreaterThan(30);
    expect(result.current.carryDistance).toBeCloseTo(carryFor(result.current.anchorFrame), 6);
    const min = result.current.contentMinHeight as number;
    expect(min).toBeCloseTo(913 + result.current.carryDistance, 6);
    await act(async () => {
      result.current.onContentSizeChange(393, min);
      jest.advanceTimersByTime(1000);
    });
    const carry = result.current.carryDistance;
    expect(carry).toBeCloseTo(carryFor(result.current.anchorFrame), 6);
    expect(result.current.restingOffset.value).toBe(-103);

    const handlers = result.current.onScroll as unknown as ScrollHandlers;
    const event = (y: number) => ({ contentOffset: { x: 0, y }, velocity: { x: 0, y: 0 } });
    // A release during the carry is plain scrolling: nothing to settle.
    handlers.onBeginDrag(event(-103));
    handlers.onScroll(event(-100));
    handlers.onEndDrag(event(-100));
    expect(scrollTo).not.toHaveBeenCalled();
    handlers.onBeginDrag(event(-100));
    handlers.onScroll(event(-103 + carry + 3));
    handlers.onScroll(event(-103 + carry + 6));
    handlers.onEndDrag(event(-103 + carry + 6));
    const collapsed = -103 + carry + PROFILE_AVATAR_COLLAPSE_DISTANCE;
    expect(scrollTo).toHaveBeenLastCalledWith({ animated: true, y: collapsed });

    // The snap's own animation lands at the collapsed rest; a pull back out
    // settles where the morph starts, the avatar whole again.
    handlers.onScroll(event(collapsed));
    handlers.onBeginDrag(event(collapsed));
    handlers.onScroll(event(collapsed - 5));
    handlers.onEndDrag(event(collapsed - 5));
    expect(scrollTo).toHaveBeenLastCalledWith({ animated: true, y: -103 + carry });
  });
});

describe("android hole-punch gooey geometry", () => {
  const avatar = { left: 152, top: 180, width: 96, height: 96 };
  // A Pixel-style 26 dp lens centred at (200, 25).
  const lens = { left: 187, top: 12, width: 26, height: 26 };

  it("ends inside the lens, a dp short of its edge on every side", () => {
    expect(profileGooeyEndDiameter(lens)).toBe(24);
    expect(profileGooeyEndScale(96, lens)).toBeCloseTo(0.25);
    expect(profileGooeyEndOffset(avatar, lens)).toEqual({ dx: 0, dy: -203 });
  });

  it("maps the scroll offset to a clamped progress", () => {
    expect(profileGooeyProgress(-20, 120)).toBe(0);
    expect(profileGooeyProgress(60, 120)).toBe(0.5);
    expect(profileGooeyProgress(500, 120)).toBe(1);
    expect(profileGooeyProgress(10, 0)).toBe(0);
  });

  it("starts as the expanded photo and ends as a circle on the lens centre", () => {
    expect(profileGooeyFrame(avatar, lens, 0, 120)).toMatchObject({
      avatarX: 200,
      avatarY: 228,
      avatarDiameter: 96,
      darkness: 0,
      blurRadius: 0,
      bridgeReach: 0,
    });
    const end = profileGooeyFrame(avatar, lens, 1, 120);
    expect(end).toMatchObject({ avatarX: 200, avatarY: 25, avatarDiameter: 24, darkness: 1 });
    expect(end.drip).toBeCloseTo(0);
  });

  it("darkens and blurs while it shrinks, before any neck forms", () => {
    const fadeStart = PROFILE_GOOEY_FADE_START * PROFILE_GOOEY_SHRINK_END;
    expect(profileGooeyFrame(avatar, lens, fadeStart, 120)).toMatchObject({
      darkness: 0,
      blurRadius: 0,
      bridgeReach: 0,
    });
    const midway = profileGooeyFrame(avatar, lens, 0.4, 120);
    expect(midway.darkness).toBeGreaterThan(0);
    expect(midway.darkness).toBeLessThan(1);
    expect(midway.blurRadius).toBeGreaterThan(0);
    expect(midway.bridgeReach).toBe(0);
  });

  it("shrinks to the lens size under it, nearly black, and is black before any neck forms", () => {
    const staged = profileGooeyFrame(avatar, lens, PROFILE_GOOEY_SHRINK_END, 120);
    expect(staged.avatarDiameter).toBeCloseTo(24);
    expect(staged.avatarX).toBe(200);
    // Still clear of the lens, nearly black, no neck yet.
    expect(staged.avatarY - staged.avatarDiameter / 2).toBeGreaterThanOrEqual(38 + 23.4 - 1e-9);
    expect(staged.darkness).toBeGreaterThan(0.8);
    // A photo never touches the lens, and the black neck, pill and drip only
    // ever meet a fully black avatar (no coloured second blob).
    for (let i = 0; i <= 200; i++) {
      const frame = profileGooeyFrame(avatar, lens, i / 200, 120);
      if (frame.darkness < 1) {
        expect(frame.avatarY - frame.avatarDiameter / 2).toBeGreaterThan(38 + 23.4 - 1e-9);
      }
      if (frame.bridgeReach > 0 || frame.drip > 0 || frame.pill > 0) expect(frame.darkness).toBe(1);
    }
    // It darkens gradually, never in one step.
    let previous = profileGooeyFrame(avatar, lens, 0, 120).darkness;
    for (let i = 1; i <= 200; i++) {
      const darkness = profileGooeyFrame(avatar, lens, i / 200, 120).darkness;
      expect(darkness - previous).toBeLessThan(0.2);
      previous = darkness;
    }
    expect(profileGooeyFrame(avatar, lens, 0.99, 120).pill).toBe(1);
    const rising = profileGooeyFrame(avatar, lens, 0.9, 120);
    expect(rising.bridgeReach).toBeGreaterThan(0);
    expect(rising.avatarDiameter).toBeCloseTo(24);
    expect(rising.avatarY).toBeLessThan(staged.avatarY);
  });

  it("never stops rising until it is in the lens", () => {
    let previous = profileGooeyFrame(avatar, lens, 0, 120).avatarY;
    for (let i = 1; i <= 100; i++) {
      const y = profileGooeyFrame(avatar, lens, i / 100, 120).avatarY;
      if (previous > 25) expect(y).toBeLessThan(previous);
      previous = y;
    }
  });

  it("keeps its bottom edge with the content, keeping the gap to the text below", () => {
    const staged = profileGooeyFrame(avatar, lens, PROFILE_GOOEY_SHRINK_END, 120);
    const stagedBottom = staged.avatarY + staged.avatarDiameter / 2;
    for (let i = 0; i <= 65; i++) {
      const p = i / 100;
      const frame = profileGooeyFrame(avatar, lens, p, 120);
      // The bottom starts at 276 and the content has moved up p * 120 dp.
      const carried = Math.max(stagedBottom, 276 - p * 120);
      expect(frame.avatarY + frame.avatarDiameter / 2).toBeLessThanOrEqual(carried + 1e-9);
    }
    // At the start it moves exactly with the content.
    const early = profileGooeyFrame(avatar, lens, 0.05, 120);
    expect(early.avatarY + early.avatarDiameter / 2).toBeCloseTo(276 - 6);
  });

  it("never grows, lightens or reverses along the way, so scrolling back retraces it", () => {
    let previous = profileGooeyFrame(avatar, lens, 0, 120);
    for (let i = 1; i <= 100; i++) {
      const frame = profileGooeyFrame(avatar, lens, i / 100, 120);
      expect(frame.avatarDiameter).toBeLessThanOrEqual(previous.avatarDiameter + 1e-9);
      expect(frame.avatarY).toBeLessThanOrEqual(previous.avatarY + 1e-9);
      expect(frame.darkness).toBeGreaterThanOrEqual(previous.darkness);
      previous = frame;
    }
    expect(profileGooeyFrame(avatar, lens, 0.42, 120)).toEqual(
      profileGooeyFrame(avatar, lens, 0.42, 120),
    );
  });
});

/** The real hook on a device, measured with the avatar at `anchor` (host = window). */
async function renderController(
  insets: { top: number; bottom: number },
  anchor = { left: 152, top: 180, width: 96, height: 96 },
) {
  jest.useFakeTimers();
  const hook = await renderHook(() => useProfileAvatarCollapse(), {
    wrapper: ({ children }) => (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 400, height: 852 },
          insets: { ...insets, left: 0, right: 0 },
        }}
      >
        {children}
      </SafeAreaProvider>
    ),
  });
  Object.assign(hook.result.current.hostRef, {
    current: { measureInWindow: (cb: (x: number, y: number) => void) => cb(0, 0) },
  });
  Object.assign(hook.result.current.anchorRef, {
    current: {
      measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
        cb(anchor.left, anchor.top, anchor.width, anchor.height),
    },
  });
  await act(async () => {
    hook.result.current.onScrollBeginDrag();
    jest.advanceTimersByTime(100);
  });
  jest.useRealTimers();
  return hook;
}

describe("android hole-punch gooey overlay", () => {
  const render = async (insets = { top: 47, bottom: 34 }) => {
    const { result } = await renderController(insets);
    return renderMobile(
      <ProfileAvatarCollapse
        controller={result.current}
        image={null}
        name="Admin HackOS"
        size={96}
        variant="account"
      />,
    );
  };

  afterEach(() => {
    mockCutoutRects = [];
    jest.restoreAllMocks();
  });

  it("draws the native gooey view on a hole-punch Android device", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    mockCutoutRects = [{ left: 182, top: 7, width: 36, height: 36 }];
    await render();
    const gooey = screen.getByTestId("profile-avatar-gooey", { includeHiddenElements: true });
    // 36 dp padded rect -> 36 dp circle centred at (200, 25), in the canvas
    // padded by the margin around the avatar/lens bounds.
    expect(gooey.props.holeDiameter).toBe(36);
    expect(gooey.props.holeX).toBe(200 - 152 + 24);
    expect(gooey.props.holeY).toBe(25 - 7 + 24);
    expect(screen.getByText("AH", { includeHiddenElements: true })).toBeTruthy();
  });

  it("draws no overlay on Android without a hole punch, leaving the avatar in the content", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await render();
    expect(
      screen.queryByTestId("profile-avatar-collapse-mask", { includeHiddenElements: true }),
    ).toBeNull();
  });

  it("keeps the Dynamic Island mask on iOS", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    mockCutoutRects = [{ left: 182, top: 7, width: 36, height: 36 }];
    await render({ top: 59, bottom: 34 });
    expect(
      screen.queryByTestId("profile-avatar-gooey", { includeHiddenElements: true }),
    ).toBeNull();
    expect(
      screen.getByTestId("profile-avatar-collapse-mask", { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it("draws no overlay on an iPhone without a Dynamic Island", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    await render({ top: 47, bottom: 34 });
    expect(
      screen.queryByTestId("profile-avatar-collapse-mask", { includeHiddenElements: true }),
    ).toBeNull();
  });
});

describe("plain avatar collapse geometry (#935)", () => {
  const minScale = PROFILE_AVATAR_SIMPLE_MIN_SCALE;

  it("releases the avatar once the name closes the gap to its shrunken bottom", () => {
    // 96 pt avatar, name 12 pt below: 12 + 96 * (1 - 0.75) / 2.
    expect(profileAvatarSimpleReleaseOffset(96, 12, minScale)).toBe(24);
    expect(profileAvatarSimpleReleaseOffset(112, 14, minScale)).toBe(28);
    // An unmeasured or overlapping name only waits for the shrink itself.
    expect(profileAvatarSimpleReleaseOffset(96, -5, minScale)).toBe(12);
  });

  it("holds still while shrinking, then moves with the content at its smallest", () => {
    expect(profileAvatarSimpleTransform(0, 96, 12, minScale, false)).toEqual({
      translateY: 0,
      scale: 1,
    });
    expect(profileAvatarSimpleTransform(12, 96, 12, minScale, false)).toEqual({
      translateY: 12,
      scale: 0.875,
    });
    // From the release on, the hold stays constant: the avatar scrolls away.
    for (const offset of [24, 60, 400]) {
      expect(profileAvatarSimpleTransform(offset, 96, 12, minScale, false)).toEqual({
        translateY: 24,
        scale: minScale,
      });
    }
    // Pull-to-refresh overscroll leaves it untouched.
    expect(profileAvatarSimpleTransform(-30, 96, 12, minScale, false)).toEqual({
      translateY: 0,
      scale: 1,
    });
  });

  it("never lets the avatar's bottom pass the name's top, and retraces it on the way back", () => {
    for (const [size, gap] of [
      [96, 12],
      [112, 14],
      [96, 0],
      [112, 80],
    ]) {
      const avatarTop = 200;
      const nameTop = avatarTop + size + gap;
      const at = (offset: number) => {
        const { translateY, scale } = profileAvatarSimpleTransform(
          offset,
          size,
          gap,
          minScale,
          false,
        );
        // Screen positions: content moves up by `offset`, the transform is about the centre.
        const centre = avatarTop + size / 2 - offset + translateY;
        return { bottom: centre + (size * scale) / 2, scale };
      };
      let previous = at(0);
      for (let offset = 0; offset <= 600; offset += 0.5) {
        const frame = at(offset);
        expect(frame.bottom).toBeLessThanOrEqual(nameTop - offset + 1e-9);
        // Monotonic in the offset, so scrolling back retraces the same frames.
        expect(frame.bottom).toBeLessThanOrEqual(previous.bottom + 1e-9);
        expect(frame.scale).toBeLessThanOrEqual(previous.scale + 1e-9);
        previous = frame;
      }
      // Far enough down the page, it has left the top of the screen.
      expect(at(600).bottom).toBeLessThan(0);
      expect(at(17)).toEqual(at(17));
    }
  });

  it("just scrolls with the content under Reduce Motion", () => {
    for (const offset of [0, 12, 300]) {
      expect(profileAvatarSimpleTransform(offset, 96, 12, minScale, true)).toEqual({
        translateY: 0,
        scale: 1,
      });
    }
  });
});

describe("plain avatar collapse (#935)", () => {
  const event = (y: number) => ({ contentOffset: { x: 0, y }, velocity: { x: 0, y: 0 } });

  afterEach(() => {
    mockCutoutRects = [];
    jest.restoreAllMocks();
    mockHaptic.mockClear();
  });

  it("measures the gap to the view below and never snaps, taps or pads the page", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    mockHaptic.mockClear();
    const { result } = await renderController({ top: 24, bottom: 0 });
    expect(result.current.simple).toBe(true);
    await act(async () => {
      result.current.onAnchorLayout({
        nativeEvent: { layout: { x: 0, y: 10, width: 96, height: 96 } },
      } as never);
      result.current.onNameLayout({
        nativeEvent: { layout: { x: 0, y: 118, width: 200, height: 80 } },
      } as never);
    });
    expect(result.current.simpleGap).toBe(12);
    await act(async () => {
      result.current.onHostLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 852 } },
      } as never);
    });
    expect(result.current.contentMinHeight).toBeUndefined();

    const scrollTo = jest.fn();
    Object.assign(result.current.scrollRef, { current: { scrollTo } });
    const handlers = result.current.onScroll as unknown as ScrollHandlers;
    handlers.onBeginDrag(event(0));
    for (const y of [10, 30, 60, 125, 60, 0]) handlers.onScroll(event(y));
    handlers.onEndDrag(event(12));
    handlers.onMomentumEnd(event(12));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(mockHaptic).not.toHaveBeenCalled();
  });

  it("keeps the in-content avatar visible while scrolled", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const { result } = await renderController({ top: 24, bottom: 0 });
    result.current.scrollOffset.value = 40;
    // The layout gap is 0 here: the hold is only the 12 pt shrink.
    await renderMobile(
      <ProfileAvatarCollapseAnchor controller={result.current} size={96}>
        <Text>AH</Text>
      </ProfileAvatarCollapseAnchor>,
    );
    const anchor = screen.getByText("AH", { includeHiddenElements: true }).parent;
    expect(StyleSheet.flatten(anchor?.props.style)).toMatchObject({
      opacity: 1,
      transform: [{ translateY: 12 }, { scale: PROFILE_AVATAR_SIMPLE_MIN_SCALE }],
    });
  });

  it("keeps the morph and its snap on a hole-punch device", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    mockCutoutRects = [{ left: 182, top: 7, width: 36, height: 36 }];
    const { result } = await renderController({ top: 48, bottom: 0 });
    expect(result.current.simple).toBe(false);
    expect(result.current.target.hasCutout).toBe(true);
  });
});
