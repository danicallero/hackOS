"use client";

import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

export function LibraryAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useLocale();
  return (
    <Button type="button" size="sm" className="shrink-0" aria-label={label} onClick={onClick}>
      <PlusIcon aria-hidden="true" />
      <span className="hidden @min-[20rem]:inline @min-[32rem]:hidden">{t("addAction")}</span>
      <span className="hidden @min-[32rem]:inline">{label}</span>
    </Button>
  );
}
