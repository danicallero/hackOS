import telegramMaskTracks from "./telegram-avatar-mask.json";

export const PROFILE_AVATAR_COLLAPSE_DISTANCE = 120;

export type ProfileCameraCutoutFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ProfileAvatarFrame = ProfileCameraCutoutFrame;

/**
 * Hardware Dynamic Island, portrait points: 126 x 37.33 on iPhone 14 Pro
 * through 17 (top 11 pt on a 59 pt safe-area inset, 14 pt on a 62 pt inset, so
 * the top is always `safeAreaTop - 48`). The morph target is inset by this
 * much on every side so the shrinking avatar and its black backing hide inside
 * the island and never poke out.
 */
const DYNAMIC_ISLAND_WIDTH = 126;
const DYNAMIC_ISLAND_HEIGHT = 37.33;
const DYNAMIC_ISLAND_TOP_OFFSET = 48;
const DYNAMIC_ISLAND_INSET = 1;

/** Largest side (dp) of a display-cutout rect still treated as a hole punch or waterdrop. */
const MAX_HOLE_PUNCH_SIZE = 72;
/** A hole punch sits in the top strip; side cutouts (landscape) are ignored. */
const MAX_HOLE_PUNCH_TOP = 96;

/**
 * Pick the narrow, top-edge cutout among the rects reported by Android's
 * DisplayCutout (window coordinates, dp). Wide notches and side cutouts are
 * rejected so they get the plain collapse instead of a misleading morph.
 */
export function pickHolePunchCutout(
  rects: ProfileCameraCutoutFrame[] | null | undefined,
  screenWidth: number,
): ProfileCameraCutoutFrame | null {
  let best: ProfileCameraCutoutFrame | null = null;
  for (const rect of rects ?? []) {
    if (!(rect.width > 0 && rect.height > 0)) continue;
    if (rect.width > MAX_HOLE_PUNCH_SIZE || rect.height > MAX_HOLE_PUNCH_SIZE) continue;
    if (rect.top > MAX_HOLE_PUNCH_TOP || rect.left < 0 || rect.left + rect.width > screenWidth)
      continue;
    if (!best || rect.top < best.top) best = rect;
  }
  if (!best) return null;
  // A hole punch is a circle: morph into the largest circle centred in the
  // measured rect, so a padded or slightly oval report never widens the target.
  const diameter = Math.min(best.width, best.height);
  return {
    left: best.left + (best.width - diameter) / 2,
    top: best.top + (best.height - diameter) / 2,
    width: diameter,
    height: diameter,
  };
}

/**
 * Resolve the camera-area morph target.
 * - iPhone with Dynamic Island: fixed island geometry (UIKit exposes none).
 * - Other devices with a hole punch: a circle the size of the real cutout read
 *   from the OS.
 * - Everything else (notch, no cutout, landscape, unknown): `hasCutout: false`,
 *   which callers render as a plain collapse/fade with no morph.
 */
export function resolveProfileCameraTarget({
  cameraCutoutFrame,
  displayCutoutRects,
  height,
  platform,
  safeAreaTop,
  screenWidth,
}: {
  cameraCutoutFrame?: ProfileCameraCutoutFrame | null;
  displayCutoutRects?: ProfileCameraCutoutFrame[] | null;
  height: number;
  platform: string;
  safeAreaTop: number;
  screenWidth: number;
}): ProfileAvatarFrame & { hasCutout: boolean } {
  const isLandscape = screenWidth > height;
  if (cameraCutoutFrame) return { ...cameraCutoutFrame, hasCutout: true };

  if (!isLandscape && platform === "ios" && safeAreaTop >= 55) {
    // iOS does not expose a public Dynamic Island frame. Use its published
    // geometry (points, relative to the app window), inset so it stays inside.
    const width = Math.min(DYNAMIC_ISLAND_WIDTH, screenWidth - 32) - 2 * DYNAMIC_ISLAND_INSET;
    return {
      left: (screenWidth - width) / 2,
      top: safeAreaTop - DYNAMIC_ISLAND_TOP_OFFSET + DYNAMIC_ISLAND_INSET,
      width,
      height: DYNAMIC_ISLAND_HEIGHT - 2 * DYNAMIC_ISLAND_INSET,
      hasCutout: true,
    };
  }

  if (!isLandscape && platform === "android") {
    const punch = pickHolePunchCutout(displayCutoutRects, screenWidth);
    if (punch) return { ...punch, hasCutout: true };
  }

  const compactSize = 40;
  return {
    left: (screenWidth - compactSize) / 2,
    top: safeAreaTop + 6,
    width: compactSize,
    height: compactSize,
    hasCutout: false,
  };
}

/** Rounded rectangle interpolation keeps the image clipped in every frame. */
export function profileAvatarMaskFrame(
  expandedSize: number,
  start: ProfileAvatarFrame,
  target: ProfileAvatarFrame,
  progress: number,
  reduceMotion = false,
) {
  "worklet";
  const value = Math.max(0, Math.min(1, progress));
  const endWidth = reduceMotion ? target.height : target.width;
  const width = expandedSize + (endWidth - expandedSize) * value;
  const height = expandedSize + (target.height - expandedSize) * value;
  // The frame centre travels linearly from the start centre to the target
  // centre, exactly like the morph path's canvas, so the clip, the image and
  // the black backing share one centre line at every progress.
  const centerX =
    start.left +
    start.width / 2 +
    (target.left + target.width / 2 - start.left - start.width / 2) * value;
  const centerY =
    start.top +
    start.height / 2 +
    (target.top + target.height / 2 - start.top - start.height / 2) * value;
  return {
    width,
    height,
    borderRadius: height / 2,
    left: centerX - width / 2,
    top: centerY - height / 2,
  };
}

/** Telegram's fade and blur progress curves, applied as a lightweight gradient cover. */
export function profileAvatarCoverOpacity(progress: number, reduceMotion = false): number {
  "worklet";
  const value = Math.max(0, Math.min(1, progress));
  const fadeAlpha = Math.max(0, Math.min(1, -0.25 + value * 1.55));
  return reduceMotion ? value * 0.7 : fadeAlpha;
}

/** A fixed canvas avoids resizing the mask host during scroll. */
export function profileAvatarCollapseBounds(start: ProfileAvatarFrame, target: ProfileAvatarFrame) {
  const left = Math.min(start.left, target.left);
  const top = Math.min(start.top, target.top);
  return {
    left,
    top,
    width: Math.max(start.left + start.width, target.left + target.width) - left,
    height: Math.max(start.top + start.height, target.top + target.height) - top,
  };
}

function circlePath(x: number, y: number, radius: number) {
  "worklet";
  return `M ${x - radius} ${y} A ${radius} ${radius} 0 1 1 ${x + radius} ${y} A ${radius} ${radius} 0 1 1 ${x - radius} ${y} Z`;
}

/** Original UserAvatarMask cubic paths, sampled at the same progress as Swift. */
export function profileAvatarMorphPath(
  size: number,
  start: ProfileAvatarFrame,
  target: ProfileAvatarFrame,
  progress: number,
  simple = false,
): string {
  "worklet";
  const p = Math.max(0, Math.min(1, progress));
  if (simple) {
    const frame = profileAvatarMaskFrame(size, start, target, p, true);
    return circlePath(frame.left + frame.width / 2, frame.top + frame.height / 2, frame.height / 2);
  }
  const scale = size / 300;
  const startCenterX = start.left + size / 2;
  const targetCenterX = target.left + target.width / 2;
  const canvasX = startCenterX + (targetCenterX - startCenterX) * p - 256 * scale;
  const initialTop = start.top + size / 2 - 234 * scale;
  // Swift anchors the 171 pt mask canvas at the island's lower edge (47.5 pt).
  const alignment = Math.min(1, p / 0.14);
  const canvasY = initialTop + (target.top + target.height - initialTop) * alignment;
  const time = p * 540;
  let result = "";
  for (const track of telegramMaskTracks) {
    if (time >= track.end) continue;
    if (track.end === 544 && (time < 108 || time >= 498)) continue;
    let index = 0;
    while (index + 1 < track.frames.length && track.frames[index + 1].time <= time) index++;
    const first = track.frames[index];
    const next = track.frames[Math.min(index + 1, track.frames.length - 1)];
    // The source's temporal cubic handles have equal x/y, giving linear time.
    const fraction =
      next.time === first.time
        ? 0
        : Math.max(0, Math.min(1, (time - first.time) / (next.time - first.time)));
    const vertices = first.path.v.map((point, i) => [
      point[0] + (next.path.v[i][0] - point[0]) * fraction,
      point[1] + (next.path.v[i][1] - point[1]) * fraction,
    ]);
    const incoming = first.path.i.map((point, i) => [
      point[0] + (next.path.i[i][0] - point[0]) * fraction,
      point[1] + (next.path.i[i][1] - point[1]) * fraction,
    ]);
    const outgoing = first.path.o.map((point, i) => [
      point[0] + (next.path.o[i][0] - point[0]) * fraction,
      point[1] + (next.path.o[i][1] - point[1]) * fraction,
    ]);
    // The thin bar is the island's lower lip: never wider than the target.
    const xScale = track.end === 544 ? Math.min(scale, Math.max(0, target.width) / 290) : scale;
    const x = (value: number) => canvasX + track.offset[0] * scale + value * xScale;
    const y = (value: number) => canvasY + (track.offset[1] + value) * scale;
    result += `M ${x(vertices[0][0])} ${y(vertices[0][1])} `;
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      result += `C ${x(vertices[i][0] + outgoing[i][0])} ${y(vertices[i][1] + outgoing[i][1])} ${x(vertices[j][0] + incoming[j][0])} ${y(vertices[j][1] + incoming[j][1])} ${x(vertices[j][0])} ${y(vertices[j][1])} `;
    }
    result += "Z ";
  }
  return result;
}
