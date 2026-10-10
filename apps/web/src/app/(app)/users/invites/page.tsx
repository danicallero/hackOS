"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { AccessDenied } from "@/components/common/access-denied";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { invitationScope } from "../invitation-scope";
import { InvitationsScreen } from "../invitations-tab";

export default function InvitationsPage() {
  const { t } = useLocale();
  const canInvite = useCan(CAPABILITIES.INVITES_MANAGE);
  const canManageSponsors = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const scope = invitationScope({ canInvite, canManageSponsors });
  if (!scope) return <AccessDenied ask={t("invitationManagement")} />;
  return <InvitationsScreen sponsorOnly={scope === "sponsor"} />;
}
