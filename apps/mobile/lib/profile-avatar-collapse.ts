import telegramMaskTracks from "./telegram-avatar-mask.json";

export const PROFILE_AVATAR_COLLAPSE_DISTANCE = 120;

/**
 * Morph progress where the photo first touches the camera cutout: the mask's
 * lip track joins the island at frame 108 of the 540-frame Telegram timeline
 * (`maskCanvas` maps progress to `time = p * 540`). The merge haptic fires here.
 */
export const PROFILE_AVATAR_MERGE_PROGRESS = 108 / 540;

/** Below this release speed the scroll view does not decelerate, so no momentum end follows. */
export const PROFILE_AVATAR_SNAP_REST_VELOCITY = 0.05;

/**
 * Direction of the scroll being released (#935): positive while the offset
 * grows (content moving up, avatar heading into the camera), negative while it
 * shrinks, 0 with no movement. The last non-zero scroll delta decides; the
 * release velocity only stands in when no delta was seen, because its sign is
 * not consistent across platforms (iOS reports the offset's, Android the
 * finger's).
 */
export function profileAvatarSnapDirection(
  lastDelta: number,
  velocity: number,
  platform: string,
): number {
  "worklet";
  if (lastDelta !== 0) return Math.sign(lastDelta);
  if (Math.abs(velocity) < PROFILE_AVATAR_SNAP_REST_VELOCITY) return 0;
  return platform === "android" ? -Math.sign(velocity) : Math.sign(velocity);
}

/**
 * Where a released scroll should settle so the avatar never rests half-morphed
 * (#935): null outside the open collapse range, otherwise fully expanded (0) or
 * fully collapsed (`distance`). Direction decides: moving up (merge started)
 * collapses, moving down (droplet coming out) expands; with no movement at
 * all, the nearer rest wins.
 *
 * `distance` is required: a worklet's default-parameter expression is not
 * captured into its UI-thread closure, so a module constant there is undefined.
 */
export function profileAvatarSnapTarget(
  offset: number,
  direction: number,
  distance: number,
): number | null {
  "worklet";
  if (!(offset > 0 && offset < distance)) return null;
  if (direction > 0) return distance;
  if (direction < 0) return 0;
  return offset >= distance / 2 ? distance : 0;
}

/*
 * Plain collapse, without a camera cutout to morph into (no Dynamic Island,
 * no Android hole punch) or under Reduce Motion (#935): the avatar stays in
 * the scroll content. It holds still and shrinks while the name below closes
 * the gap, then rides up and off screen with the content, so it never parks
 * at the top or covers the text.
 */

/** Scale the plain-collapse avatar ends its shrink at. */
export const PROFILE_AVATAR_SIMPLE_MIN_SCALE = 0.75;

/**
 * Scroll offset at which the plain-collapse avatar stops holding still and
 * starts moving with the content: the moment the name's top (`gap` below the
 * avatar's laid-out bottom) reaches the shrunken avatar's bottom.
 */
export function profileAvatarSimpleReleaseOffset(
  size: number,
  gap: number,
  minScale: number,
): number {
  "worklet";
  return Math.max(0, gap) + (Math.max(0, size) * (1 - minScale)) / 2;
}

/**
 * Transform for the in-content avatar at `offset` past the true top: a
 * `translateY` that cancels the scroll while it holds still, and a scale
 * about its centre that reaches `minScale` exactly at the release offset.
 * Reduce Motion skips the shrink and hold, so it just scrolls with the page.
 */
export function profileAvatarSimpleTransform(
  offset: number,
  size: number,
  gap: number,
  minScale: number,
  reduceMotion: boolean,
): { translateY: number; scale: number } {
  "worklet";
  if (reduceMotion) return { translateY: 0, scale: 1 };
  const release = profileAvatarSimpleReleaseOffset(size, gap, minScale);
  if (!(release > 0)) return { translateY: 0, scale: 1 };
  const hold = Math.min(Math.max(0, offset), release);
  return { translateY: hold, scale: 1 - ((1 - minScale) * hold) / release };
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
 * Absolute content offset a released scroll should settle at, or null (#935).
 * `restingOffset` is the content offset of the true top: negative under iOS's
 * automatic inset, where y 0 sits that far past the top, inside the morph.
 * `maxOffset` is the furthest offset the content surely reaches.
 */
export function profileAvatarSnapOffset(
  contentOffset: number,
  restingOffset: number,
  direction: number,
  distance: number,
  maxOffset: number,
): number | null {
  "worklet";
  const target = profileAvatarSnapTarget(contentOffset - restingOffset, direction, distance);
  if (target === null) return null;
  // A page too short to reach the collapsed rest expands instead of leaving
  // the scroll past its end.
  return target > 0 && restingOffset + target > maxOffset ? restingOffset : restingOffset + target;
}

/**
 * Upper bound for the true top's content offset on iOS (#935): the automatic
 * inset always covers the part of the scroll view under the status bar, or
 * under a shown native header (`headerHeight`, status bar included), so the
 * top rests at least that far above y 0. The scroll events observed before
 * the first drag tighten it further when an inset is larger still.
 */
export function profileAvatarRestingOffsetBound(
  safeAreaTop: number,
  hostTop: number,
  headerHeight = 0,
): number {
  return -Math.max(0, Math.max(safeAreaTop, headerHeight) - hostTop);
}

/**
 * Smallest content height that keeps both rests reachable (#935): a short
 * page must still scroll from its true top (`restingOffset`, at most 0) to
 * the collapsed rest, or the snap could only ever expand.
 */
export function profileAvatarMinContentHeight(
  viewportHeight: number,
  restingOffset: number,
  distance: number,
): number {
  return viewportHeight + Math.max(0, distance + Math.min(0, restingOffset));
}

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
 * Where the avatar image sits at `progress` (#935): a square centred on the
 * mask's blob and covering it, joined with the neck that stretches up to the
 * island. The blob, not the linear mask frame, carries the picture: the mask
 * reaches the island at a fixed progress whatever the start's distance, so on
 * a page whose avatar sits lower (a native header above it) the linear frame
 * trails below the clip and would pull the photo off its centre. After the
 * blob ends, its last square travels on to the island.
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
  if (simple) {
    const frame = profileAvatarMaskFrame(size, start, target, p, true);
    return { left: frame.left, top: frame.top, width: frame.width, height: frame.height };
  }
  const blobProgress = Math.min(p, BLOB_END_PROGRESS - 1e-4);
  const blob = profileAvatarBlobBounds(size, start, target, blobProgress);
  let half = size / 2;
  let cx = start.left + start.width / 2;
  let cy = start.top + start.height / 2;
  if (blob) {
    half = Math.max(blob.width, blob.height) / 2;
    cx = blob.left + blob.width / 2;
    cy = blob.top + blob.height / 2;
  }
  if (p > blobProgress) {
    // Past its end the blob's last square eases into the island.
    const travel = (p - blobProgress) / (1 - blobProgress);
    const endHalf = target.height / 2;
    half += (endHalf - half) * travel;
    cx += (target.left + target.width / 2 - cx) * travel;
    cy += (target.top + target.height / 2 - cy) * travel;
  }
  const neck = Math.max(0, Math.min(1, (p - 0.15) / 0.35));
  const top = Math.min(cy - half, cy - half + (target.top - (cy - half)) * neck);
  const neckHalf = Math.max(half, (target.width * neck) / 2);
  return {
    left: cx - neckHalf,
    top,
    width: 2 * neckHalf,
    height: cy + half - top,
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

/*
 * Android hole-punch gooey morph (`modules/profile-gooey`): the avatar stays
 * a circle, scales uniformly and travels to the lens, ending a hair smaller
 * than it, while a black liquid neck joins the two. The native view only
 * draws the frame computed here.
 */

/** A circle in view-local dp: centre and diameter. */
export type ProfileGooeyCircle = { x: number; y: number; diameter: number };

/**
 * Progress at which the shrinking photo reaches the lens size, centred under
 * it. The liquid neck only forms after this, so a large photo never stretches
 * towards the lens.
 */
export const PROFILE_GOOEY_SHRINK_END = 0.65;
/**
 * Progress at which the shrinking photo starts to blur and darken. It is a
 * black disc by `PROFILE_GOOEY_SHRINK_END`, before the black neck touches it.
 */
export const PROFILE_GOOEY_FADE_START = 0.15;
/** Edge-to-edge gap (in lens diameters) between the shrunken photo and the lens. */
const PROFILE_GOOEY_STAGING_GAP = 0.9;
/** The end circle sits this far (dp) inside the lens edge so it never pokes out. */
const PROFILE_GOOEY_LENS_INSET = 1;
/** Padding (dp) around the native canvas for the neck, drip and blur. */
export const PROFILE_GOOEY_MARGIN = 24;
/** Strongest progressive blur on the photo (dp, Android 12+ only). */
const PROFILE_GOOEY_MAX_BLUR = 6;

function clamp01(value: number) {
  "worklet";
  return Math.max(0, Math.min(1, value));
}

/** Diameter the avatar ends at: the lens, inset on every side. */
export function profileGooeyEndDiameter(hole: ProfileCameraCutoutFrame): number {
  "worklet";
  return Math.max(0, Math.min(hole.width, hole.height) - 2 * PROFILE_GOOEY_LENS_INSET);
}

/** Uniform scale of the avatar at the end of the morph. */
export function profileGooeyEndScale(size: number, hole: ProfileCameraCutoutFrame): number {
  if (!(size > 0)) return 1;
  return Math.max(0, Math.min(1, profileGooeyEndDiameter(hole) / size));
}

/** Vector the avatar centre travels to reach the lens centre. */
export function profileGooeyEndOffset(
  start: ProfileCameraCutoutFrame,
  hole: ProfileCameraCutoutFrame,
): { dx: number; dy: number } {
  return {
    dx: hole.left + hole.width / 2 - (start.left + start.width / 2),
    dy: hole.top + hole.height / 2 - (start.top + start.height / 2),
  };
}

/** Scroll offset to morph progress: 0 expanded, 1 inside the lens. */
export function profileGooeyProgress(scrollOffset: number, distance: number): number {
  "worklet";
  return distance > 0 ? clamp01(scrollOffset / distance) : 0;
}

/**
 * Everything the native gooey view draws at `progress`, in its local dp:
 * - Until `PROFILE_GOOEY_SHRINK_END` the photo shrinks uniformly to the end
 *   diameter while gliding (ease-out) to a point centred under the lens.
 *   From `PROFILE_GOOEY_FADE_START` it also blurs and darkens, reaching a
 *   black disc exactly as it gets there.
 * - Afterwards the black disc rises into the lens; the neck may form
 *   (`bridgeReach` is how far apart the two circles' edges can be and still
 *   join) and a short drip hangs from the lens, so the last frames are a
 *   droplet sinking into the camera.
 */
export function profileGooeyFrame(
  start: ProfileCameraCutoutFrame,
  hole: ProfileCameraCutoutFrame,
  progress: number,
) {
  "worklet";
  const t = clamp01(progress);
  const endDiameter = profileGooeyEndDiameter(hole);
  const holeDiameter = Math.min(hole.width, hole.height);
  const holeX = hole.left + hole.width / 2;
  const holeY = hole.top + hole.height / 2;
  const gap = holeDiameter * PROFILE_GOOEY_STAGING_GAP;
  const stagingY = holeY + holeDiameter / 2 + endDiameter / 2 + gap;
  const startX = start.left + start.width / 2;
  const startY = start.top + start.height / 2;
  const shrink = clamp01(t / PROFILE_GOOEY_SHRINK_END);
  const glide = 1 - (1 - shrink) * (1 - shrink);
  const rise = clamp01((t - PROFILE_GOOEY_SHRINK_END) / (1 - PROFILE_GOOEY_SHRINK_END));
  const neck = clamp01((t - PROFILE_GOOEY_SHRINK_END) / 0.08);
  const fadeSpan = PROFILE_GOOEY_SHRINK_END - PROFILE_GOOEY_FADE_START;
  return {
    avatarX: startX + (holeX - startX) * glide,
    avatarY: startY + (stagingY - startY) * glide + (holeY - stagingY) * rise,
    avatarDiameter: start.width + (endDiameter - start.width) * glide,
    imageAlpha: 1 - clamp01((t - PROFILE_GOOEY_FADE_START) / fadeSpan),
    blurRadius: PROFILE_GOOEY_MAX_BLUR * clamp01((t - PROFILE_GOOEY_FADE_START) / fadeSpan),
    bridgeReach: gap * 1.2 * neck,
    drip: holeDiameter * 0.25 * Math.sin(Math.PI * rise),
  };
}
