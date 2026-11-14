"use client";

import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { ShellBanner } from "@/components/layout/shell-banner";
import { useViewedEdition } from "@/hooks/use-editions";
import { useLocale } from "@/lib/i18n";

/** A closed edition is read-only; the notice stays for as long as it is viewed. */
export function EditionNotice() {
  const edition = useViewedEdition();
  const { t } = useLocale();
  if (edition?.status !== "closed") return null;

  return (
    <ShellBanner
      tone="info"
      icon={<LockSimpleIcon aria-hidden="true" className="text-primary size-4 shrink-0" />}
      action={null}
    >
      {t("editionClosedReadOnly", { name: edition.name })}
    </ShellBanner>
  );
}
