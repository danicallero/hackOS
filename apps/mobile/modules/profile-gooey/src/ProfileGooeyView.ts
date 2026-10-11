import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import { Platform, type ViewProps } from "react-native";

/** All values are dp in the view's own coordinates (see `profileGooeyFrame`). */
export type ProfileGooeyViewProps = ViewProps & {
  holeX: number;
  holeY: number;
  holeDiameter: number;
  avatarX?: number;
  avatarY?: number;
  avatarDiameter?: number;
  darkness?: number;
  blurRadius?: number;
  bridgeReach?: number;
  drip?: number;
};

/**
 * Android-only native view; null on other platforms and on a binary built
 * before the module existed, so callers fall back to the JS collapse.
 */
export const ProfileGooeyView: ComponentType<ProfileGooeyViewProps> | null =
  Platform.OS === "android" && requireOptionalNativeModule("ProfileGooey")
    ? requireNativeView<ProfileGooeyViewProps>("ProfileGooey")
    : null;
