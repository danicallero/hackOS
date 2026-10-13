"use client";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  type ProjectSubmission,
  projectSubmission,
  requestProjectEdits,
  submitProject,
} from "@/lib/projects";

/**
 * H20: a project's submission state for its members. Submitting records a
 * snapshot and keeps the project editable until the deadline; members can
 * resubmit, and only an organizer lock stops editing (#1006).
 */
export function ProjectLifecycle({
  id,
  name,
  onChanged,
  children,
}: {
  id: number;
  name: string;
  onChanged: () => Promise<void>;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const [state, setState] = useState<ProjectSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const requestTrigger = useRef<HTMLButtonElement>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      setState(await projectSubmission(id));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("couldNotLoadProject"));
    }
  }, [id, t]);
  useEffect(() => {
    void load();
  }, [load]);
  async function mutate(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("couldNotSaveProject"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const pending = state?.requests.some((r) => r.status === "pending");
  const submitted = state?.status === "submitted";
  const submitLabel = submitted ? t("resubmitProject") : t("submitProject");
  return (
    <div className="space-y-4">
      {children}
      <SectionCard
        title={t("projectSubmission")}
        state={
          state ? (
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={submitted ? "success" : "neutral"}>
                {t(submitted ? "projectSubmittedStatus" : "projectDraft")}
              </StatusBadge>
              {state.changedSinceSubmit && (
                <StatusBadge tone="warning">{t("projectChangedSinceSubmit")}</StatusBadge>
              )}
            </div>
          ) : undefined
        }
        headerClassName="flex-row items-center justify-between gap-2 sm:items-center"
        action={
          state?.lockedAt && !pending ? (
            <Button
              ref={requestTrigger}
              variant="outline"
              onClick={() => {
                setError(null);
                setRequestOpen(true);
              }}
            >
              {t("projectRequestEdits")}
            </Button>
          ) : !state?.lockedAt && (!submitted || state?.changedSinceSubmit) ? (
            <Button
              disabled={busy || !state?.canSubmit}
              onClick={() => {
                setError(null);
                setConfirm(true);
              }}
            >
              {submitLabel}
            </Button>
          ) : undefined
        }
      >
        {state?.lockedAt ? (
          <div className="space-y-2">
            <p className="text-sm">{t("projectSubmittedLocked")}</p>
            {pending && (
              <p className="text-sm" role="status">
                {t("projectRequestPending")}
              </p>
            )}
          </div>
        ) : state?.status === "draft" && state.submittedAt ? (
          <p className="text-sm">{t("projectReopened")}</p>
        ) : null}
        {state?.teamSizeViolation && (
          <p className="text-sm text-destructive">{t("projectTeamSizeViolation")}</p>
        )}
        {error && !requestOpen && !confirm && <ContextualError message={error} onRetry={load} />}
      </SectionCard>
      <SidePanelEditor
        open={requestOpen}
        onOpenChange={setRequestOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          requestTrigger.current?.focus();
        }}
        title={t("projectRequestEdits")}
        footer={
          <Button
            loading={busy}
            disabled={!reason.trim()}
            onClick={async () => {
              if (await mutate(() => requestProjectEdits(id, reason.trim()))) {
                setRequestOpen(false);
                setReason("");
              }
            }}
          >
            {t("projectRequestEdits")}
          </Button>
        }
      >
        <p className="mb-4 text-sm font-medium wrap-break-word">{name}</p>
        <div className="space-y-2">
          <label htmlFor="edit-request-reason" className="type-label">
            {t("projectReason")}
          </label>
          <Textarea
            id="edit-request-reason"
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {error && <ContextualError message={error} />}
      </SidePanelEditor>
      <AlertModal
        open={confirm}
        onOpenChange={setConfirm}
        title={submitLabel}
        description={t("projectSubmitConfirm")}
        confirmLabel={submitLabel}
        cancelLabel={t("cancel")}
        pending={busy}
        onConfirm={async () => {
          if (await mutate(() => submitProject(id))) setConfirm(false);
        }}
      >
        <p className="text-sm font-medium wrap-break-word">{name}</p>
        {error && <ContextualError message={error} />}
      </AlertModal>
    </div>
  );
}
