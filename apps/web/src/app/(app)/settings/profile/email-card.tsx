"use client";

import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
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
        <span className="text-success flex items-center gap-1.5 text-sm font-medium">
          <SealCheckIcon aria-hidden="true" weight="fill" className="size-5" />
          {t("verified")}
        </span>
      ) : (
        <span className="text-warning flex items-center gap-1.5 text-sm font-medium">
          <WarningCircleIcon aria-hidden="true" weight="fill" className="size-5" />
          {t("unverified")}
        </span>
      )}
    </li>
  );
}
