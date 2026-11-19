import { mascotAvatarChoice } from "@hackos/shared/mascot-avatars";
import { Image, type ImageProps } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated";
import { SymbolView } from "@/components/symbol";
import { useColorScheme } from "@/components/useColorScheme";
import { diaryInitials } from "@/lib/diary";
import { apiImageSource } from "@/lib/directory";
import { prefetchImageTint, useImageBleed } from "@/lib/image-tint";
import { mascotAvatar } from "@/lib/mascot-avatar";
import { colors } from "@/theme/colors";
import { motion } from "@/theme/tokens";

/**
 * How long a photo dissolves over its initials (H55, #935): the same for every
 * avatar, so a list row and the profile it opens change alike.
 */
export const IMAGE_FADE_MS = motion.duration.fast;

export interface ApiImage {
  /** True once the photo has drawn; callers show their fallback until then. */
  loaded: boolean;
  /** Props for an `expo-image` `Image`, or null without a photo or after it failed. */
  props: Pick<ImageProps, "source" | "cachePolicy" | "onLoad" | "onError" | "transition"> | null;
}

/**
 * Keeps a photo that is still loading laid out but invisible, so its fallback
 * stays in place until `loaded` (#934).
 */
export const loadingImageStyle = { position: "absolute", opacity: 0 } as const;

/**
 * An authenticated API image (`/api/users/:id/photo`, #934) for `expo-image`:
 * render `<Image {...props} />` while `props` is set, hidden with
 * `loadingImageStyle` until `loaded`, and the fallback until then. A missing
 * or hidden photo (an error) drops `props` and keeps the fallback. `persist`
 * keeps the bytes on disk, for the signed-in person's own photo so it still
 * shows offline; other people's photos stay in memory so a hidden one is gone
 * after the next launch. Every caller passes the same `apiImageSource` (same
 * cache key), so a photo a list drew is reused by the profile and its hero.
 */
export function useApiImage(uri: string | null | undefined, persist = false): ApiImage {
  const [status, setStatus] = useState<{ uri: string; loaded: boolean } | null>(null);
  const reduceMotion = useReducedMotion();
  // Switching account goes through sign-in, which remounts every avatar, so
  // the session in the cache key is read once per photo.
  const source = useMemo(() => (uri ? apiImageSource(uri) : null), [uri]);
  const current = uri && status?.uri === uri ? status : null;
  if (!uri || !source || (current && !current.loaded)) return { loaded: false, props: null };
  return {
    loaded: current?.loaded ?? false,
    props: {
      source,
      cachePolicy: persist ? "disk" : "memory",
      transition: reduceMotion ? 0 : IMAGE_FADE_MS,
      onLoad: () => setStatus({ uri, loaded: true }),
      onError: () => setStatus({ uri, loaded: false }),
    },
  };
}

/**
 * The fallback under a photo fades out while the photo dissolves in, so the
 * initials cross into the picture instead of jumping (H55).
 */
export function useFallbackFade(loaded: boolean) {
  const reduceMotion = useReducedMotion();
  return useAnimatedStyle(
    () => ({
      opacity: reduceMotion
        ? loaded
          ? 0
          : 1
        : withTiming(loaded ? 0 : 1, { duration: IMAGE_FADE_MS }),
    }),
    [loaded, reduceMotion],
  );
}

/**
 * A directory photo, assigned mascot or a placeholder symbol (#934). Mascots show
 * until the authenticated photo arrives, then cross-fade into it. Person
 * photos are round and cropped; sponsor logos keep their shape inside a
 * rounded tile.
 */
export function PersonAvatar({
  size,
  name,
  userId,
  uri,
  kind = "person",
  logoNegativeUrl,
  testID,
}: {
  size: number;
  userId?: string | number;
  name?: string | null;
  uri: string | null;
  kind?: "person" | "sponsor";
  logoNegativeUrl?: string | null;
  testID?: string;
}) {
  const dark = useColorScheme() === "dark";
  const negative = kind === "sponsor" && dark && !!logoNegativeUrl;
  const shown = negative ? logoNegativeUrl : uri;
  const photo = useApiImage(shown);
  const fallbackFade = useFallbackFade(photo.loaded);
  const bleed = useImageBleed(kind === "sponsor" ? shown : null);
  const imageSize = kind === "sponsor" && bleed ? size * 0.84 : size;
  // The page this avatar opens tints its hero with the image; get it ready first.
  useEffect(() => prefetchImageTint(shown), [shown]);
  const frame = {
    alignItems: "center" as const,
    backgroundColor: kind === "sponsor" && !negative ? colors.accentText : colors.elevatedSurface,
    borderRadius: kind === "person" ? size / 2 : size * 0.23,
    height: size,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    width: size,
  };
  // One tree for every state, so the image is not remounted when it loads.
  // The fallback sits under the photo, which draws nothing until it has
  // loaded and then dissolves in (`transition`) as the fallback fades out.
  return (
    <View testID={testID} style={frame}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            alignItems: "center",
            justifyContent: "center",
            // Tinted like the account avatar, so it reads on grouped and plain grounds.
            backgroundColor: name ? colors.accentSurface : undefined,
          },
          fallbackFade,
        ]}
      >
        {kind === "person" && name ? (
          <Image
            testID={testID ? `${testID}-mascot` : undefined}
            source={mascotAvatar(userId, name)}
            accessible={false}
            contentFit="cover"
            style={{
              height: size,
              width: size,
              backgroundColor: mascotAvatarChoice(userId, name).background,
            }}
          />
        ) : name ? (
          <Text
            accessible={false}
            style={{ color: colors.onAccentSurface, fontSize: size * 0.36, fontWeight: "600" }}
          >
            {diaryInitials(name)}
          </Text>
        ) : (
          <SymbolView
            accessible={false}
            name={kind === "person" ? "person.fill" : "building.2"}
            size={size * 0.45}
            tintColor={colors.secondaryLabel}
          />
        )}
      </Animated.View>
      {photo.props ? (
        <Image
          {...photo.props}
          testID={testID ? `${testID}-image` : undefined}
          accessible={false}
          contentFit={kind === "person" ? "cover" : "contain"}
          style={{ height: imageSize, width: imageSize }}
        />
      ) : null}
    </View>
  );
}
