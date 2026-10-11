import telegramMaskTracks from "./telegram-avatar-mask.json";

export const PROFILE_AVATAR_COLLAPSE_DISTANCE = 120;

/** Release speed (points/ms, positive while the offset grows) that reads as a flick. */
const PROFILE_AVATAR_SNAP_FLICK_VELOCITY = 0.3;
/** Below this release speed the scroll view does not decelerate, so no momentum end follows. */
export const PROFILE_AVATAR_SNAP_REST_VELOCITY = 0.05;

/**
 * Where a released scroll should settle so the avatar never rests half-morphed
 * (#935): null outside the open collapse range, otherwise fully expanded (0) or
 * fully collapsed (`distance`). A flick decides by direction, a slow release by
 * which half of the range the offset is in.
 *
 * `distance` is required: a worklet's default-parameter expression is not
 * captured into its UI-thread closure, so a module constant there is undefined.
 */
export function profileAvatarSnapTarget(
  offset: number,
  velocity: number,
  distance: number,
): number | null {
  "worklet";
  if (!(offset > 0 && offset < distance)) return null;
  if (velocity >= PROFILE_AVATAR_SNAP_FLICK_VELOCITY) return distance;
  if (velocity <= -PROFILE_AVATAR_SNAP_FLICK_VELOCITY) return 0;
  return offset >= distance / 2 ? distance : 0;
}

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

type MaskTrack = (typeof telegramMaskTracks)[number];

/** The avatar blob track: the circle that stretches up into the island. */
const BLOB_TRACK_END = 153;
/** Progress at which the blob ends and only the island lip remains. */
const BLOB_END_PROGRESS = BLOB_TRACK_END / 540;
/** The lip (drip) track hanging from the island's lower edge. */
const LIP_TRACK_END = 544;
/** The lip's widest point, bezier handles included, in mask units. */
const LIP_HALF_EXTENT = 151.3;
/** The lip's top edge sits this many mask units above the island's lower edge. */
const LIP_TOP_DEPTH = 5;

/**
 * Half-width the lip may take at the island's lower edge (#935). A stadium
 * island is straight there only for `width - height`; past that its corners
 * curve up, so a lip as wide as the island pokes out of them. A circular
 * hole punch has no straight run, so it gets the chord at the lip's top edge.
 */
function lipHalfWidth(target: ProfileAvatarFrame, scale: number) {
  "worklet";
  const radius = target.height / 2;
  const straight = Math.max(0, target.width - target.height) / 2;
  const depth = Math.min(radius, LIP_TOP_DEPTH * scale);
  const chord = Math.sqrt(Math.max(0, radius * radius - (radius - depth) * (radius - depth)));
  return Math.max(straight, chord);
}

/** The Swift mask canvas origin and scale at `progress`. */
function maskCanvas(
  size: number,
  start: ProfileAvatarFrame,
  target: ProfileAvatarFrame,
  p: number,
) {
  "worklet";
  const scale = size / 300;
  const startCenterX = start.left + size / 2;
  const targetCenterX = target.left + target.width / 2;
  const canvasX = startCenterX + (targetCenterX - startCenterX) * p - 256 * scale;
  const initialTop = start.top + size / 2 - 234 * scale;
  // Swift anchors the 171 pt mask canvas at the island's lower edge (47.5 pt).
  const alignment = Math.min(1, p / 0.14);
  const canvasY = initialTop + (target.top + target.height - initialTop) * alignment;
  return { scale, canvasX, canvasY, time: p * 540 };
}

/** One track's keyframe pair and the linear fraction between them at `time`. */
function trackKeyframes(track: MaskTrack, time: number) {
  "worklet";
  let index = 0;
  while (index + 1 < track.frames.length && track.frames[index + 1].time <= time) index++;
  const first = track.frames[index];
  const next = track.frames[Math.min(index + 1, track.frames.length - 1)];
  // The source's temporal cubic handles have equal x/y, giving linear time.
  const fraction =
    next.time === first.time
      ? 0
      : Math.max(0, Math.min(1, (time - first.time) / (next.time - first.time)));
  return { first, next, fraction };
}

/**
 * Bounding box of the avatar blob in the morph mask at `progress`, or null
 * once it has ended. The blob rises and narrows faster than the linear mask
 * frame, so content placed from that frame lags below the clip.
 */
export function profileAvatarBlobBounds(
  size: number,
  start: ProfileAvatarFrame,
  target: ProfileAvatarFrame,
  progress: number,
): ProfileAvatarFrame | null {
  "worklet";
  const p = Math.max(0, Math.min(1, progress));
  const { scale, canvasX, canvasY, time } = maskCanvas(size, start, target, p);
  const track = telegramMaskTracks.find((candidate) => candidate.end === BLOB_TRACK_END);
  if (!track || time >= track.end) return null;
  const { first, next, fraction } = trackKeyframes(track, time);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  // The blob's handles are tangent at its extremes, so its vertices bound it.
  for (let i = 0; i < first.path.v.length; i++) {
    const vx = first.path.v[i][0] + (next.path.v[i][0] - first.path.v[i][0]) * fraction;
    const vy = first.path.v[i][1] + (next.path.v[i][1] - first.path.v[i][1]) * fraction;
    const x = canvasX + (track.offset[0] + vx) * scale;
    const y = canvasY + (track.offset[1] + vy) * scale;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Where the avatar image sits at `progress` (#935): a square covering the
 * mask's blob and centred on it, so the picture follows the clip instead of
 * exposing the backing at its top, joined with the neck that stretches up to
 * the island. After the blob ends it eases back to the neck alone.
 */
export function profileAvatarContentFrame(
  size: number,
  start: ProfileAvatarFrame,
  target: ProfileAvatarFrame,
  progress: number,
  simple = false,
): ProfileAvatarFrame {
  "worklet";
  const p = Math.max(0, Math.min(1, progress));
  const frame = profileAvatarMaskFrame(size, start, target, p, simple);
  if (simple) return { left: frame.left, top: frame.top, width: frame.width, height: frame.height };
  const neck = Math.max(0, Math.min(1, (p - 0.15) / 0.35));
  const neckTop = frame.top + (target.top - frame.top) * neck;
  const neckHalf = Math.max(frame.width, target.width * neck) / 2;
  const centerX = frame.left + frame.width / 2;
  const neckBox = {
    left: centerX - neckHalf,
    top: neckTop,
    right: centerX + neckHalf,
    bottom: frame.top + frame.height,
  };
  // Past its end the blob is held at its last shape while the box eases back.
  const blob = profileAvatarBlobBounds(size, start, target, Math.min(p, BLOB_END_PROGRESS - 1e-4));
  let box = neckBox;
  if (blob) {
    const half = Math.max(blob.width, blob.height) / 2;
    const cx = blob.left + blob.width / 2;
    const cy = blob.top + blob.height / 2;
    const fade = Math.max(0, Math.min(1, (p - BLOB_END_PROGRESS) / 0.1));
    const mix = (covered: number, neckSide: number) => covered + (neckSide - covered) * fade;
    box = {
      left: mix(Math.min(neckBox.left, cx - half), neckBox.left),
      top: mix(Math.min(neckBox.top, cy - half), neckBox.top),
      right: mix(Math.max(neckBox.right, cx + half), neckBox.right),
      bottom: mix(Math.max(neckBox.bottom, cy + half), neckBox.bottom),
    };
  }
  return {
    left: box.left,
    top: box.top,
    width: box.right - box.left,
    height: box.bottom - box.top,
  };
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
  const { scale, canvasX, canvasY, time } = maskCanvas(size, start, target, p);
  const lipScale = Math.min(scale, lipHalfWidth(target, scale) / LIP_HALF_EXTENT);
  let result = "";
  for (const track of telegramMaskTracks) {
    if (time >= track.end) continue;
    if (track.end === LIP_TRACK_END && (time < 108 || time >= 498)) continue;
    const { first, next, fraction } = trackKeyframes(track, time);
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
    const xScale = track.end === LIP_TRACK_END ? lipScale : scale;
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
