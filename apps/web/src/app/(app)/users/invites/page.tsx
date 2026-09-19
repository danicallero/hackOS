"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { AccessDenied } from "@/components/common/access-denied";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { InvitationsScreen } from "../invitations-tab";

export default function InvitationsPage() {
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.INVITES_MANAGE);
  if (!canManage) return <AccessDenied ask={t("invitationManagement")} />;
  return <InvitationsScreen />;
}
