import { mascotAvatarChoice } from "@hackos/shared/mascot-avatars";
import { Image } from "expo-image";
import { View } from "react-native";
import { loadingImageStyle, useApiImage } from "@/components/person-avatar";
import { mascotAvatar } from "@/lib/mascot-avatar";
import { colors } from "@/theme/colors";

/**
 * A person's account photo, or their assigned mascot when there is none or it cannot
 * load. Decorative by default: callers show the name beside it.
 */
export function UserAvatar({
  name,
  surname,
  userId,
  image,
  size = 40,
  persist = false,
  testID,
}: {
  userId?: string | number;
  name: string;
  /** Surname on its own, used with the name when no user id is available. */
  surname?: string | null;
  /** Authenticated photo route from the API, or null. */
  image: string | null | undefined;
  size?: number;
  /** The signed-in person's own photo: cached on disk to survive offline launches. */
  persist?: boolean;
  testID?: string;
}) {
  // The photo route is private: it is fetched with the session, and the
  // mascot stays until it arrives or when it cannot load (#934).
  const photo = useApiImage(image, persist);
  const displayName = [name, surname].filter(Boolean).join(" ");
  const fallback = mascotAvatarChoice(userId, displayName);

  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        alignItems: "center",
        backgroundColor: photo.loaded ? colors.elevatedSurface : fallback.background,
        borderCurve: "continuous",
        borderRadius: size / 2,
        height: size,
        justifyContent: "center",
        overflow: "hidden",
        width: size,
      }}
    >
      {photo.loaded ? null : (
        <Image
          testID={testID ? `${testID}-mascot` : undefined}
          source={mascotAvatar(userId, displayName)}
          accessible={false}
          contentFit="cover"
          style={{ height: size, width: size, backgroundColor: fallback.background }}
        />
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
