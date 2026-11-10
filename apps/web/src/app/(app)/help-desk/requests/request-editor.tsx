"use client";
import { useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { Modal } from "@/components/common/modal";
import { useLocale } from "@/lib/i18n";
import type { HelpRequest } from "../model";
import { RequestForm } from "./request-form";

/** H64: creation and editing share one modal, pending boundary and draft-discard decision. */
export function RequestEditor({
  open,
  onOpenChange,
  onSaved,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  request?: HelpRequest;
}) {
  const { t } = useLocale();
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  return (
    <Modal
      open={open}
      title={t(request ? "helpDeskEdit" : "helpDeskRequestHelp")}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next && dirty) setDiscard(true);
        else onOpenChange(next);
      }}
    >
      <RequestForm
        request={request}
        onDirtyChange={setDirty}
        onPendingChange={setPending}
        onSaved={onSaved}
      />
      <AlertModal
        open={discard}
        onOpenChange={setDiscard}
        title={t("unsavedChanges")}
        description={t("unsavedChangesConfirm")}
        cancelLabel={t("keepEditing")}
        confirmLabel={t("discardLibraryChanges")}
        destructive
        onConfirm={() => {
          setDiscard(false);
          onOpenChange(false);
        }}
      />
    </Modal>
  );
}
