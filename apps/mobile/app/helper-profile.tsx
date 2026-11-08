import { Redirect } from "expo-router";
import { HelperProfileSection } from "@/components/help-desk/helper-profile-section";
import { HelpPage } from "@/components/help-desk/primitives";
import { ActionButton } from "@/components/native-ui";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";

/**
 * H61: an accepted mentor can prepare their help desk settings before they
 * have event access. With access, helper settings live in the public profile
 * editor (they extend that same profile), so this route opens it instead.
 */
export default function HelperProfileRoute() {
  const { t } = useLocale();
  const { me } = useMeContext();
  if (me?.hasEventAccess) return <Redirect href="/networking-profile" />;
  return (
    <HelpPage title={t("helpMyProfile")} showBack={false}>
      <HelperProfileSection />
      <ActionButton label={t("signOut")} onPress={() => void signOut()} />
    </HelpPage>
  );
}
