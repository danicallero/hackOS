"use client";

import { SaveStatus } from "@/components/common/save-status";
import { SubmitButton } from "@/components/common/submit-button";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";

export function CategorySaveFooter({ pending, state }: { pending: boolean; state: SaveState }) {
  const { t } = useLocale();
  return (
    <>
      <SubmitButton pending={pending}>{t("saveChanges")}</SubmitButton>
      <SaveStatus state={state} />
    </>
  );
}
