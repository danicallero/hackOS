import telegramMaskTracks from "./telegram-avatar-mask.json";

export const PROFILE_AVATAR_COLLAPSE_DISTANCE = 120;

export type ProfileCameraCutoutFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ProfileAvatarFrame = ProfileCameraCutoutFrame;

const DYNAMIC_ISLAND_HEIGHT = 36.67;

/** Resolve a compact camera-area target without requiring platform cutout APIs. */
export function resolveProfileCameraTarget({
  cameraCutoutFrame,
  height,
  manufacturer,
  modelId,
  modelName,
  platform,
  safeAreaTop,
  screenWidth,
  statusBarHeight,
}: {
  cameraCutoutFrame?: ProfileCameraCutoutFrame | null;
  height: number;
  manufacturer: string | null;
  modelId: string | null;
  modelName: string | null;
  platform: string;
  safeAreaTop: number;
  screenWidth: number;
  statusBarHeight: number;
}): ProfileAvatarFrame & { hasCutout: boolean } {
  const isLandscape = screenWidth > height;
  if (cameraCutoutFrame) return { ...cameraCutoutFrame, hasCutout: true };

  let cutout: ProfileCameraCutoutFrame | null = null;
  if (!isLandscape && platform === "ios") {
    const id = modelId ?? "";
    // iOS does not expose a public Dynamic Island frame. Use its measured
    // safe-area/viewport geometry in points, relative to the app window.
    const dynamicIsland = safeAreaTop >= 55;
    const hasNotch =
      dynamicIsland ||
      /^iPhone(?:10,[36]|11,[2468]|12,[1358]|13,[1245]|14,[235678])$/.test(id) ||
      safeAreaTop >= 44;
    if (hasNotch) {
      const width = Math.min(
        dynamicIsland ? (screenWidth >= 400 ? 125.33 : 125) : 176,
        screenWidth - 32,
      );
      const cutoutHeight = dynamicIsland ? DYNAMIC_ISLAND_HEIGHT : 34;
      // The iPhone 15 viewport is 393×852 with a 59 pt top inset and an
      // 11.33 pt island top. iPhone 16/17 Pro is 402×874 with a 62 pt inset
      // and a 14 pt island top. Newer tall cutout areas retain the same
      // 48 pt separation from their safe-area edge (for example iPhone Air).
      const islandTop = safeAreaTop >= 60 ? safeAreaTop - 48 : safeAreaTop - 47.67;
      cutout = {
        left: (screenWidth - width) / 2,
        top: dynamicIsland ? islandTop : 0,
        width,
        height: cutoutHeight,
      };
    }
  } else if (!isLandscape && platform === "android") {
    const device = `${manufacturer ?? ""} ${modelName ?? ""}`;
    const hasKnownPunchHole =
      /pixel\s*(?:4a|5|[6-9]|1\d)/i.test(device) ||
      /(?:galaxy\s*(?:s|z|a\s*(?:5\d|6\d|7\d|8\d))|sm-[agsz]\d{3,})/i.test(device) ||
      /(?:xiaomi\s*1[0-9]|redmi\s*note\s*[89]|poco\s*[fxm]\d|oneplus\s*[789]|nothing\s*phone|motorola\s*edge)/i.test(
        device,
      );
    const hasTallDisplayCutout = safeAreaTop > statusBarHeight + 6;
    if (hasKnownPunchHole) {
      const diameter = Math.min(28, safeAreaTop || 28);
      cutout = {
        left: (screenWidth - diameter) / 2,
        top: Math.max(0, (safeAreaTop - diameter) / 2),
        width: diameter,
        height: diameter,
      };
    } else if (hasTallDisplayCutout) {
      const width = Math.min(150, screenWidth - 32);
      const cutoutHeight = Math.min(34, safeAreaTop);
      cutout = {
        left: (screenWidth - width) / 2,
        top: Math.max(0, (safeAreaTop - cutoutHeight) / 2),
        width,
        height: cutoutHeight,
      };
    }
  }

  if (cutout) return { ...cutout, hasCutout: true };

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
  return {
    width,
    height,
    borderRadius: height / 2,
    left: start.left + (target.left + (target.width - width) / 2 - start.left) * value,
    top: start.top + (target.top + (target.height - height) / 2 - start.top) * value,
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
    const x = (value: number) => canvasX + (track.offset[0] + value) * scale;
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
