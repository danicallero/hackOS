"use client";

import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { StatusBadge } from "@/components/common/status-badge";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/** Account row: the primary email and its verification state. */
export function EmailRow() {
  const { me } = useSessionContext();
  const { t } = useLocale();
  if (!me) return null;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <EnvelopeSimpleIcon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t("emailAddressTitle")}</p>
        <p className="text-muted-foreground break-all text-sm">
          {me.email}
          <span className="text-foreground ml-2 text-xs">{t("primaryEmail")}</span>
        </p>
      </div>
      {me.emailVerified ? (
        <StatusBadge tone="success" icon={<SealCheckIcon aria-hidden="true" weight="fill" />}>
          {t("verified")}
        </StatusBadge>
      ) : (
        <StatusBadge tone="warning" icon={<WarningCircleIcon aria-hidden="true" weight="fill" />}>
          {t("unverified")}
        </StatusBadge>
      )}
    </li>
  );
}
