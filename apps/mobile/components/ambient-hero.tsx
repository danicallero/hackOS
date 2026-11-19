import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { Platform, StyleSheet, View } from "react-native";
import { apiImageSource } from "@/lib/directory";
import { ambientVeil, heroTint, type RGB } from "@/lib/hero-tint";

/** The hero box: it starts above the content to cover the pull-down bounce. */
const HERO_TOP = -300;
const HERO_HEIGHT = 620;

const box = {
  height: HERO_HEIGHT,
  left: 0,
  position: "absolute",
  right: 0,
  top: HERO_TOP,
} as const;

/** Style blur needs Android 12 (RenderEffect); older devices keep the single-colour wash. */
const canBlur = Platform.OS !== "android" || Number(Platform.Version) >= 31;

/**
 * A page header washed in an image's own colours (H44, H48): the image itself,
 * enlarged and blurred until no shape (a logo's letters) survives, under a veil
 * of the page colour and fading into the page, so each side keeps its colour.
 * It is the same request as the avatar or logo on the page, so the image is
 * downloaded once: iOS blurs the copy already in memory (expo-image queries the
 * original cache first), Android blurs the untransformed image with a style
 * filter, since Glide would fetch a transformed one again. Private photos stay
 * in memory only, like the avatar (#934). Without an image the hero is the
 * single-colour wash (`fallback`, blue for people and projects).
 */
export function ImageHero({
  uri,
  dark,
  fallback,
  testID,
}: {
  uri: string | null | undefined;
  dark: boolean;
  fallback?: RGB;
  testID?: string;
}) {
  if (!uri || !canBlur) {
    return (
      <View
        testID={testID}
        pointerEvents="none"
        style={[box, { experimental_backgroundImage: heroTint(null, dark, fallback).gradient }]}
      />
    );
  }
  return (
    <View testID={testID} pointerEvents="none" style={[box, { overflow: "hidden" }]}>
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <View
            style={{
              experimental_backgroundImage:
                "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 60%, rgba(0,0,0,0) 100%)",
              flex: 1,
            }}
          />
        }
      >
        <Image
          accessible={false}
          blurRadius={Platform.OS === "ios" ? 180 : undefined}
          cachePolicy="memory"
          contentFit="cover"
          source={apiImageSource(uri)}
          // A slow connection fades the colours in instead of popping them.
          transition={600}
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [{ scale: 1.4 }],
              ...(Platform.OS === "android" ? { filter: [{ blur: 120 }] } : null),
            },
          ]}
          testID={testID ? `${testID}-image` : undefined}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: ambientVeil(dark) }]} />
      </MaskedView>
    </View>
  );
}

/** Label colour on an `ImageHero`: the page's own over an image, else the wash's pick. */
export function useImageHeroForeground(
  uri: string | null | undefined,
  dark: boolean,
  fallback?: RGB,
): string | undefined {
  return uri && canBlur ? undefined : heroTint(null, dark, fallback).foreground;
}
