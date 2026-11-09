import { withNativeHeaderSheet } from "@/components/adaptive-frame";
import { HelperProfileSection } from "@/components/help-desk/helper-profile-section";
import { HelpPage } from "@/components/help-desk/primitives";
import { ActionButton } from "@/components/native-ui";
import NetworkingProfileScreen from "@/components/networking-profile-screen";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";

const HelpDeskSettings = withNativeHeaderSheet(() => <NetworkingProfileScreen mode="helpDesk" />);

/**
 * H61: the help desk settings: the public profile editor (card, in-place
 * editing, what others see) with the help desk sections below it. An accepted
 * mentor without event access (not yet confirmed) has no public profile to
 * edit yet, so they get the sections alone with Sign out.
 */
export default function HelperProfileRoute() {
  const { t } = useLocale();
  const { me } = useMeContext();
  if (me?.hasEventAccess) return <HelpDeskSettings />;
  return (
    <HelpPage title={t("helpDesk")} showBack={false}>
      <HelperProfileSection />
      <ActionButton label={t("signOut")} onPress={() => void signOut()} />
    </HelpPage>
  );
}
