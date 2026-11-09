import { withNativeHeaderSheet } from "@/components/adaptive-frame";
import { HelperProfileSection } from "@/components/help-desk/helper-profile-section";
import { HelpPage } from "@/components/help-desk/primitives";
import { ActionButton } from "@/components/native-ui";
import NetworkingProfileScreen from "@/components/networking-profile-screen";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";

const PublicProfile = withNativeHeaderSheet(NetworkingProfileScreen);

/**
 * H61: the help desk settings live under the public profile, so this route is
 * that screen. An accepted mentor without event access (not yet confirmed) has
 * no public profile to edit yet, so they get the help desk section alone with
 * Sign out.
 */
export default function HelperProfileRoute() {
  const { t } = useLocale();
  const { me } = useMeContext();
  if (me?.hasEventAccess) return <PublicProfile />;
  return (
    <HelpPage title={t("helpDesk")} showBack={false}>
      <HelperProfileSection />
      <ActionButton label={t("signOut")} onPress={() => void signOut()} />
    </HelpPage>
  );
}
