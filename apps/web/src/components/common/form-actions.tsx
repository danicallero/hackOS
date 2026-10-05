"use client";

import { ActionGroup } from "@/components/common/action-group";
import { SaveStatus } from "@/components/common/save-status";
import { SubmitButton } from "@/components/common/submit-button";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";

/** Save state leads; secondary actions and the final submit sit at the trailing edge. */
export function FormActions({
  pending,
  state,
  disabled = false,
  form,
  secondaryActions,
}: {
  pending: boolean;
  state: SaveState;
  disabled?: boolean;
  form?: string;
  secondaryActions?: React.ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <SaveStatus state={pending ? "saving" : state} showIcon={!pending} />
      <ActionGroup className="ml-auto">
        {secondaryActions}
        <SubmitButton pending={pending} disabled={disabled} form={form}>
          {t("saveChanges")}
        </SubmitButton>
      </ActionGroup>
    </div>
  );
}
