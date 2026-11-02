"use client";

import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { statusLabel, statusTone } from "../lib";

/** H12: actionable drafts use a discard control in place of a duplicate state badge. */
export function ApplicationHeader({
  title,
  description,
  status,
  canDiscard,
  discarding,
  disabled,
  onDiscard,
}: {
  title: string;
  description?: string;
  status?: string;
  canDiscard: boolean;
  discarding: boolean;
  disabled: boolean;
  onDiscard: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function discard() {
    setError(null);
    try {
      await onDiscard();
    } catch (error) {
      setError(apiErrorText(error, t, t("couldNotDeleteApplicationDraft")));
    }
  }
  return (
    <>
      <PageHeader
        title={title}
        className="flex-row items-start justify-between gap-2"
        description={description}
        secondaryActions={
          canDiscard ? (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || discarding}
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
            >
              <TrashIcon aria-hidden="true" className="size-4 min-[360px]:hidden" />
              <span className="max-[359px]:sr-only">{t("discardApplicationDraft")}</span>
            </Button>
          ) : undefined
        }
        state={
          !canDiscard && status ? (
            <StatusBadge tone={statusTone(status)} dot={false}>
              {statusLabel(status, t)}
            </StatusBadge>
          ) : undefined
        }
      />
      <AlertModal
        open={open}
        onOpenChange={setOpen}
        title={t("discardApplicationDraft")}
        description={t("deleteApplicationDraftDescription", { name: title })}
        cancelLabel={t("cancel")}
        confirmLabel={t("discardApplicationDraft")}
        destructive
        pending={discarding}
        onConfirm={() => void discard()}
      >
        {error && <ContextualError message={error} />}
      </AlertModal>
    </>
  );
}
