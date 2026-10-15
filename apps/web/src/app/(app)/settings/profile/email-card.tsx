"use client";

import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/** Shows the account's primary email and its verification state. */
export function EmailCard() {
  const { me } = useSessionContext();
  const { t } = useLocale();
  if (!me) return null;

  return (
    <SectionCard icon={EnvelopeSimpleIcon} title={t("emailAddressTitle")}>
      <div className="space-y-2">
        <Label htmlFor="primary-email">{t("primaryEmailLabel")}</Label>
        <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <Input id="primary-email" value={me.email} disabled readOnly />
          <div>
            {me.emailVerified ? (
              <StatusBadge tone="success">{t("verified")}</StatusBadge>
            ) : (
              <StatusBadge tone="warning">{t("unverified")}</StatusBadge>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
