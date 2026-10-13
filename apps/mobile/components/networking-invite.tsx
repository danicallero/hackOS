import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import {
  fetchNetworkingProfile,
  NETWORKING_PROFILE_PATH,
  type NetworkingProfile,
  needsNetworkingInvite,
} from "@/lib/networking-profile";
import { colors } from "@/theme/colors";

/**
 * H15: right after a participant confirms their spot, invites them to create
 * the public profile people they network with will read (#934, #935). Shown
 * only while they have never created it; a failed read just hides it.
 */
export function NetworkingInvite() {
  const { t } = useLocale();
  const router = useRouter();
  const [profile, setProfile] = useState<NetworkingProfile | null>(null);

  useEffect(() => {
    let active = true;
    fetchNetworkingProfile()
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!needsNetworkingInvite(profile)) return null;
  return (
    <View testID="networking-invite" style={{ gap: 8 }}>
      <Text selectable style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 21 }}>
        {t("networkingInvite")}
      </Text>
      <ActionButton
        label={t("networkingInviteAction")}
        icon="person.crop.circle"
        onPress={() => router.push(NETWORKING_PROFILE_PATH)}
      />
    </View>
  );
}
