"use client";

import { ActionGroup } from "@/components/common/action-group";
import { SaveStatus } from "@/components/common/save-status";
import { SubmitButton } from "@/components/common/submit-button";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import {
  ariaKeyShortcuts,
  SAVE_SHORTCUT_ATTR,
  SHORTCUTS,
  useIsApplePlatform,
} from "@/lib/shortcuts";

/**
 * Save state leads; secondary actions and the final submit sit at the trailing
 * edge. The submit is the scope's ⌘S/Ctrl+S target (#1182, lib/shortcuts.ts).
 */
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
  const apple = useIsApplePlatform();
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <SaveStatus state={pending ? "saving" : state} showIcon={!pending} />
      <ActionGroup className="ml-auto">
        {secondaryActions}
        <SubmitButton
          pending={pending}
          disabled={disabled}
          form={form}
          {...{ [SAVE_SHORTCUT_ATTR]: pending ? "saving" : state }}
          aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.save, apple)}
        >
          {t("saveChanges")}
        </SubmitButton>
      </ActionGroup>
    </div>
  );
}
