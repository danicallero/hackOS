import { MenuView } from "@expo/ui/community/menu";
import { ActivityIndicator, View } from "react-native";
import { SymbolView } from "@/components/symbol";
import { UserAvatar } from "@/components/user-avatar";
import { useLocale } from "@/lib/i18n";
import { useProfilePhoto } from "@/lib/use-profile-photo";
import { colors } from "@/theme/colors";

/**
 * The account avatar as the control that edits it (#934): tapping opens a
 * native menu to take a photo, choose one, or remove the current one. The
 * avatar shows a spinner while the change is in flight. The native menu owns
 * the press, so the trigger stays a plain view.
 */
export function ProfilePhotoMenu({
  name,
  image,
  size,
  testID,
}: {
  name: string;
  image: string | null | undefined;
  size: number;
  testID?: string;
}) {
  const { t } = useLocale();
  const { pending, run } = useProfilePhoto();
  const busy = pending !== null;
  const badge = Math.max(22, Math.round(size * 0.3));

  return (
    <MenuView
      shouldOpenOnLongPress={false}
      actions={[
        {
          id: "camera",
          title: t("profilePhotoTake"),
          image: "camera" as const,
          attributes: { disabled: busy },
        },
        {
          id: "library",
          title: t("profilePhotoChoose"),
          image: "photo" as const,
          attributes: { disabled: busy },
        },
        ...(image
          ? [
              {
                id: "remove",
                title: t("profilePhotoRemove"),
                image: "trash" as const,
                attributes: { destructive: true, disabled: busy },
              },
            ]
          : []),
      ]}
      onPressAction={({ nativeEvent }) => {
        const action = nativeEvent.event;
        if (action === "camera" || action === "library" || action === "remove") void run(action);
      }}
    >
      <View
        accessible
        accessibilityLabel={image ? t("profilePhotoChange") : t("profilePhotoAdd")}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        style={{ height: size, width: size }}
      >
        <UserAvatar testID={testID} name={name} image={image} size={size} />
        {busy ? (
          <View
            testID="profile-photo-pending"
            style={{
              alignItems: "center",
              backgroundColor: "rgba(0,0,0,0.35)",
              borderRadius: size / 2,
              bottom: 0,
              justifyContent: "center",
              left: 0,
              position: "absolute",
              right: 0,
              top: 0,
            }}
          >
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <View
            style={{
              alignItems: "center",
              backgroundColor: colors.elevatedSurface,
              borderColor: colors.background,
              borderRadius: badge / 2,
              borderWidth: 2,
              bottom: -2,
              height: badge,
              justifyContent: "center",
              position: "absolute",
              right: -2,
              width: badge,
            }}
          >
            <SymbolView
              accessible={false}
              name="camera.fill"
              size={Math.round(badge * 0.5)}
              tintColor={colors.label}
            />
          </View>
        )}
      </View>
    </MenuView>
  );
}
