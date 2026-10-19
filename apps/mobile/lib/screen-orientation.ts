import { useEffect } from "react";
import { Dimensions } from "react-native";

/**
 * A phone-sized display stays portrait; anything with a smallest side of at
 * least 600dp (an unfolded foldable, a tablet) rotates freely, and so does a
 * squarish display (long side under 1.6 times the short one) such as the iPhone
 * Duo's, whose panels stay under 600dp but whose unfolded shape is not a phone's. Android 12L+
 * letterboxes a portrait-locked app on those displays and Android 16 ignores
 * the lock, so the lock is applied by display size at runtime instead of
 * declared for every device in the manifest.
 */
export const LARGE_SCREEN_MIN_SIDE = 600;

export const SQUARISH_MAX_ASPECT = 1.6;

export type OrientationPolicy = "portrait" | "any";

/** Decided on the physical display, not the window: split-screen must not flip it. */
export function orientationPolicy(screen: { width: number; height: number }): OrientationPolicy {
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  return short >= LARGE_SCREEN_MIN_SIDE || long < short * SQUARISH_MAX_ASPECT ? "any" : "portrait";
}

interface OrientationModule {
  OrientationLock: { PORTRAIT_UP: number };
  lockAsync(lock: number): Promise<void>;
  unlockAsync(): Promise<void>;
}

/**
 * The native module ships with the app binary. A development client built
 * before it was added lacks it, so the lookup fails soft: no lock is applied
 * and the app behaves as before until the client is rebuilt.
 */
function nativeModule(): OrientationModule | null {
  try {
    return require("expo-screen-orientation") as OrientationModule;
  } catch {
    return null;
  }
}

export async function applyOrientationPolicy(
  policy: OrientationPolicy,
  module: OrientationModule | null = nativeModule(),
): Promise<void> {
  if (!module) return;
  try {
    if (policy === "portrait") await module.lockAsync(module.OrientationLock.PORTRAIT_UP);
    else await module.unlockAsync();
  } catch {
    // An unsupported or refused lock (multi-window, a foreground change) is not an app error.
  }
}

/** Keeps the lock in step with the display as it folds, unfolds or moves between screens. */
export function useOrientationPolicy(): void {
  useEffect(() => {
    void applyOrientationPolicy(orientationPolicy(Dimensions.get("screen")));
    const subscription = Dimensions.addEventListener("change", ({ screen }) => {
      void applyOrientationPolicy(orientationPolicy(screen));
    });
    return () => subscription.remove();
  }, []);
}
