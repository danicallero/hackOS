"use client";

// Administrative decision actions for the response open in the review modal.

import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { GavelIcon } from "@phosphor-icons/react/dist/csr/Gavel";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { IconButton } from "@/components/common/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import type { ResponseRow } from "@/lib/applications";
import { useLocale } from "@/lib/i18n";

export interface RunOptions {
  /** A decision stays in the modal until the reviewer closes it. */
  refresh?: boolean;
  nextStatus?: ResponseRow["status"];
  notify?: () => void;
}

type RunAction = (label: string, fn: () => Promise<unknown>, options?: RunOptions) => Promise<void>;

/** Admin decisions stay available without competing with the review forum. */
export function DecisionMenu({
  status,
  busy,
  run,
  responseId,
  canOverride,
  onRequestRevoke,
  onAccepted,
}: {
  status: ResponseRow["status"];
  busy: boolean;
  run: RunAction;
  responseId: number;
  canOverride: boolean;
  onRequestRevoke: () => void;
  onAccepted: () => void;
}) {
  const { t } = useLocale();
  const reviewActions = status === "review";
  const outboxActions = status === "accepted_internal" || status === "rejected_internal";
  const sentActions = ["accepted", "rejected", "confirmed", "declined", "expired"].includes(status);
  const hasAvailableActions = reviewActions || outboxActions || sentActions;

  const items = (
    <>
      <DropdownMenuLabel>{t("decisionLabel")}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {!hasAvailableActions && (
        <DropdownMenuItem disabled>{t("noDecisionActions")}</DropdownMenuItem>
      )}
      {reviewActions && (
        <>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() =>
              void run(
                t("acceptedUnsentToast"),
                () => api.post(`/api/responses/${responseId}/decide`, { decision: "accepted" }),
                {
                  refresh: false,
                  nextStatus: "accepted_internal",
                  notify: onAccepted,
                },
              )
            }
          >
            {t("accept")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={busy}
            onSelect={() =>
              void run(
                t("rejectedUnsentToast"),
                () => api.post(`/api/responses/${responseId}/decide`, { decision: "rejected" }),
                { refresh: false, nextStatus: "rejected_internal" },
              )
            }
          >
            {t("reject")}
          </DropdownMenuItem>
        </>
      )}
      {outboxActions && (
        <>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() =>
              void run(
                t("decisionSent"),
                () => api.post(`/api/responses/${responseId}/send-decision`),
                {
                  refresh: false,
                  nextStatus: status === "accepted_internal" ? "accepted" : "rejected",
                },
              )
            }
          >
            <PaperPlaneTiltIcon aria-hidden="true" />
            {t("sendDecision")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() =>
              void run(
                t("movedBackToReview"),
                () =>
                  api.post(`/api/responses/${responseId}/revert-decision`, {
                    decision: "review",
                  }),
                { refresh: false, nextStatus: "review" },
              )
            }
          >
            {t("backToReview")}
          </DropdownMenuItem>
        </>
      )}
      {status !== "draft" && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={busy}>
              <FileTextIcon aria-hidden="true" />
              {t("returnToDraft")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              align="start"
              className="w-72 max-w-[calc(100vw-2rem)]"
              style={{ direction: "ltr" }}
            >
              <DropdownMenuItem
                className="whitespace-normal leading-snug"
                onSelect={() =>
                  void run(
                    t("returnedToDraft"),
                    () =>
                      api.post(`/api/responses/${responseId}/return-to-draft`, {
                        allow_resubmit_after_close: false,
                        auto_accept_on_resubmit: false,
                      }),
                    { refresh: false, nextStatus: "draft" },
                  )
                }
              >
                {t("returnToDraftOpen")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-normal leading-snug"
                onSelect={() =>
                  void run(
                    t("returnedToDraft"),
                    () =>
                      api.post(`/api/responses/${responseId}/return-to-draft`, {
                        allow_resubmit_after_close: true,
                        auto_accept_on_resubmit: false,
                      }),
                    { refresh: false, nextStatus: "draft" },
                  )
                }
              >
                {t("returnToDraftLate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-normal leading-snug"
                onSelect={() =>
                  void run(
                    t("returnedToDraft"),
                    () =>
                      api.post(`/api/responses/${responseId}/return-to-draft`, {
                        allow_resubmit_after_close: true,
                        auto_accept_on_resubmit: true,
                      }),
                    { refresh: false, nextStatus: "draft" },
                  )
                }
              >
                {t("returnToDraftAutoAccept")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      )}
      {sentActions && (
        <>
          {(status === "accepted" || status === "rejected" || status === "expired") && (
            <DropdownMenuItem
              disabled={busy}
              onSelect={() =>
                void run(
                  t("decisionResent"),
                  () => api.post(`/api/responses/${responseId}/resend-decision`),
                  { refresh: false, nextStatus: status === "expired" ? "accepted" : status },
                )
              }
            >
              {t("resend")}
            </DropdownMenuItem>
          )}
          {(status === "accepted" || status === "rejected") && (
            <DropdownMenuItem
              disabled={busy}
              onSelect={() =>
                void run(
                  t("movedBackToReview"),
                  () =>
                    api.post(`/api/responses/${responseId}/revert-decision`, {
                      decision: "review",
                    }),
                  { refresh: false, nextStatus: "review" },
                )
              }
            >
              {t("backToReview")}
            </DropdownMenuItem>
          )}
          {(status === "rejected" || status === "declined" || status === "expired") && (
            <DropdownMenuItem
              disabled={busy}
              onSelect={() =>
                void run(
                  t("reaccepted"),
                  () => api.post(`/api/responses/${responseId}/re-accept`, undefined),
                  { refresh: false, nextStatus: "accepted" },
                )
              }
            >
              {t("reaccept")}
            </DropdownMenuItem>
          )}
          {(status === "accepted" || status === "confirmed") && (
            <DropdownMenuItem variant="destructive" disabled={busy} onSelect={onRequestRevoke}>
              {t("revokeSpot")}
            </DropdownMenuItem>
          )}
          {canOverride && status === "accepted" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy}
                onSelect={() =>
                  void run(
                    t("spotConfirmed"),
                    () => api.post(`/api/responses/${responseId}/confirm`),
                    { refresh: false, nextStatus: "confirmed" },
                  )
                }
              >
                {t("confirmOverride")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={busy}
                onSelect={() =>
                  void run(
                    t("spotDeclined"),
                    () => api.post(`/api/responses/${responseId}/decline`),
                    { refresh: false, nextStatus: "declined" },
                  )
                }
              >
                {t("declineOverride")}
              </DropdownMenuItem>
            </>
          )}
        </>
      )}
    </>
  );
  // H12/H14: keep the submenu and its chevron on the same (trailing) side of
  // the decision menu. Radix flips it automatically when the viewport is tight.
  return (
    <DropdownMenu dir="ltr">
      <DropdownMenuTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          disabled={busy}
          label={t("decisionMenuLabel")}
        >
          <GavelIcon aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52" style={{ direction: "ltr" }}>
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
