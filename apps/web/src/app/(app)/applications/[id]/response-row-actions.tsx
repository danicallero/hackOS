"use client";

// Inline decision actions for the responses list (H14): a pending row
// decides or sends without opening the review modal; once resolved the same
// area shows the state marker.

import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { StateSwap } from "@/components/common/list-motion";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { applicationStatusLabel } from "@/lib/application-workflow";
import { type ResponseRow, statusTone } from "@/lib/applications";
import { useLocale } from "@/lib/i18n";

export type InlineAction = "accept" | "reject" | "send";

/** The actions a row offers in its trailing cell, by status. */
export function inlineActionsFor(status: string): InlineAction[] {
  if (status === "review") return ["accept", "reject"];
  if (status === "accepted_internal" || status === "rejected_internal") return ["send"];
  return [];
}

export function ResponseRowActions({
  row,
  canDecide,
  markerInline,
  onAct,
}: {
  row: ResponseRow;
  canDecide: boolean;
  /** Show the state marker here once no action remains (the list has no status column). */
  markerInline: boolean;
  onAct: (row: ResponseRow, action: InlineAction) => void;
}) {
  const { t } = useLocale();
  // In the review workspace a resolved row only shows its marker before it
  // leaves; Send belongs to the outbox.
  const actions =
    canDecide && !(markerInline && row.status !== "review") ? inlineActionsFor(row.status) : [];
  const name = row.name ?? row.email;
  if (actions.length === 0 && !markerInline) return null;

  return (
    <StateSwap stateKey={actions.length > 0 ? `actions:${row.status}` : `marker:${row.status}`}>
      {actions.length > 0 ? (
        <div className="flex items-center justify-end gap-2" data-row-actions={row.id}>
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${t(action)}: ${name}`}
              onClick={() => onAct(row, action)}
            >
              {action === "accept" && <CheckIcon aria-hidden="true" />}
              {action === "reject" && <XIcon aria-hidden="true" />}
              {action === "send" && <PaperPlaneTiltIcon aria-hidden="true" />}
              {t(action)}
            </Button>
          ))}
        </div>
      ) : (
        <StatusBadge tone={statusTone(row.status)}>
          {applicationStatusLabel(row.status, t)}
        </StatusBadge>
      )}
    </StateSwap>
  );
}
