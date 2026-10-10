import { useState } from "react";
import { Image, type ImageURISource, Text, View } from "react-native";
import { getCurrentSessionCookie } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { colors } from "@/theme/colors";

/**
 * Image source for an authenticated API asset such as `/api/users/:id/photo`
 * (#934). The photo object is private, so the request carries the same session
 * cookie as `apiFetch`; absolute URLs pass through unchanged.
 */
export function authenticatedImageSource(path: string): ImageURISource {
  const uri = /^https?:\/\//i.test(path) ? path : `${API_URL.replace(/\/+$/, "")}${path}`;
  const cookie = getCurrentSessionCookie();
  return cookie ? { uri, headers: { cookie } } : { uri };
}

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
  testID,
}: {
  name: string;
  /** Authenticated photo route from the API, or null. */
  image: string | null | undefined;
  size?: number;
  testID?: string;
}) {
  // Remember which photo failed, so a new photo route gets its own attempt.
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const showPhoto = Boolean(image) && failedImage !== image;

  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        alignItems: "center",
        backgroundColor: showPhoto ? colors.elevatedSurface : colors.accent,
        borderCurve: "continuous",
        borderRadius: size / 2,
        height: size,
        justifyContent: "center",
        overflow: "hidden",
        width: size,
      }}
    >
      {showPhoto && image ? (
        <Image
          testID={testID ? `${testID}-photo` : undefined}
          accessible={false}
          source={authenticatedImageSource(image)}
          resizeMode="cover"
          onError={() => setFailedImage(image)}
          style={{ height: size, width: size }}
        />
      ) : (
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
    </View>
  );
}
