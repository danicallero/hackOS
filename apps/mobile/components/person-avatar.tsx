import { Image, type ImageProps } from "expo-image";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";
import { diaryInitials } from "@/lib/diary";
import { apiImageSource } from "@/lib/directory";
import { colors } from "@/theme/colors";

export interface ApiImage {
  /** True once the photo has drawn; callers show their fallback until then. */
  loaded: boolean;
  /** Props for an `expo-image` `Image`, or null without a photo or after it failed. */
  props: Pick<ImageProps, "source" | "cachePolicy" | "onLoad" | "onError"> | null;
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
 * after the next launch.
 */
export function useApiImage(uri: string | null | undefined, persist = false): ApiImage {
  const [status, setStatus] = useState<{ uri: string; loaded: boolean } | null>(null);
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
      onLoad: () => setStatus({ uri, loaded: true }),
      onError: () => setStatus({ uri, loaded: false }),
    },
  };
}

/**
 * A directory photo, initials or a placeholder symbol (#934). Initials show
 * until the authenticated photo arrives. Person photos are round and cropped;
 * sponsor logos keep their shape inside a rounded tile.
 */
export function PersonAvatar({
  size,
  name,
  uri,
  kind = "person",
}: {
  size: number;
  name?: string | null;
  uri: string | null;
  kind?: "person" | "sponsor";
}) {
  const photo = useApiImage(uri);
  const frame = {
    alignItems: "center" as const,
    backgroundColor: colors.elevatedSurface,
    borderRadius: kind === "person" ? size / 2 : size * 0.23,
    height: size,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    width: size,
  };
  const image = photo.props ? (
    <Image
      {...photo.props}
      accessible={false}
      contentFit={kind === "person" ? "cover" : "contain"}
      style={[{ height: size, width: size }, !photo.loaded && loadingImageStyle]}
    />
  ) : null;
  // One tree for every state, so the image is not remounted when it loads.
  return (
    <View
      style={[
        frame,
        // Tinted like the account avatar, so it reads on grouped and plain grounds.
        name && !photo.loaded ? { backgroundColor: colors.accentSurface } : null,
      ]}
    >
      {photo.loaded ? null : name ? (
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
      {image}
    </View>
  );
}
