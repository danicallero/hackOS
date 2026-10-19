import { Image } from "expo-image";
import { Text, View } from "react-native";
import { loadingImageStyle, useApiImage } from "@/components/person-avatar";
import { colors } from "@/theme/colors";

/** Up to two initials: first and last word, or the first letters of one word. */
export function avatarInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part));
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).join("").toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * A person's account photo, or their initials when there is none or it cannot
 * load. Decorative by default: callers show the name beside it.
 */
export function UserAvatar({
  name,
  image,
  size = 40,
  persist = false,
  testID,
}: {
  name: string;
  /** Authenticated photo route from the API, or null. */
  image: string | null | undefined;
  size?: number;
  /** The signed-in person's own photo: cached on disk to survive offline launches. */
  persist?: boolean;
  testID?: string;
}) {
  // The photo route is private: it is fetched with the session, and the
  // initials stay until it arrives or when it cannot load (#934).
  const photo = useApiImage(image, persist);

  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        alignItems: "center",
        backgroundColor: photo.loaded ? colors.elevatedSurface : colors.accent,
        borderCurve: "continuous",
        borderRadius: size / 2,
        height: size,
        justifyContent: "center",
        overflow: "hidden",
        width: size,
      }}
    >
      {photo.loaded ? null : (
        <Text
          style={{
            color: colors.accentText,
            fontSize: Math.round(size * 0.36),
            fontWeight: "700",
          }}
        >
          {avatarInitials(name)}
        </Text>
      )}
      {photo.props ? (
        <Image
          {...photo.props}
          testID={testID ? `${testID}-photo` : undefined}
          accessible={false}
          contentFit="cover"
          style={[{ height: size, width: size }, !photo.loaded && loadingImageStyle]}
        />
      ) : null}
    </View>
  );
}
