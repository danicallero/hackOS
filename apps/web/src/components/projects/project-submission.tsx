"use client";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActionGroup } from "@/components/common/action-group";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  claimProject,
  type LinkCandidate,
  type ProjectSubmission,
  projectLinkCandidates,
  projectSubmission,
  requestProjectEdits,
  type SubmissionParticipant,
  submitProject,
} from "@/lib/projects";

export function ParticipantList({ members }: { members: SubmissionParticipant[] }) {
  const { t } = useLocale();
  return (
    <ul className="space-y-2 text-sm">
      {members.map((m) => (
        <li className="wrap-break-word" key={m.key ?? m.email ?? String(m.userId)}>
          {[m.name, m.surname].filter(Boolean).join(" ") || m.email || t("projectUnknownIdentity")}
        </li>
      ))}
    </ul>
  );
}
export function ParticipantDifference({ state }: { state: ProjectSubmission }) {
  const { t } = useLocale();
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="type-label">{t("projectInternalParticipants")}</p>
        <ParticipantList members={state.internal} />
      </div>
      <div className="space-y-2">
        <p className="type-label">{t("projectDevpostParticipants")}</p>
        <ParticipantList members={state.external} />
      </div>
    </div>
  );
}
export function ProjectLifecycle({
  id,
  name,
  stage,
  code,
  canSubmit = true,
  onChanged,
  children,
}: {
  id: number;
  name: string;
  canSubmit?: boolean;
  stage: "projects" | "work-groups";
  code?: string;
  onChanged: () => Promise<void>;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const [state, setState] = useState<ProjectSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const requestTrigger = useRef<HTMLButtonElement>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const load = useCallback(async () => {
    if (stage === "work-groups") return;
    try {
      setState(await projectSubmission(id));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("couldNotLoadProject"));
    }
  }, [id, stage, t]);
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
  const displayCode = state?.code ?? code;
  const pending = state?.requests.some((r) => r.status === "pending");
  return (
    <div className="space-y-4">
      {children}
      <SectionCard
        title={t("projectSubmission")}
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
          ) : undefined
        }
      >
        {state?.lockedAt ? (
          <div className="mb-6 space-y-2">
            <p className="text-sm">{t("projectSubmittedLocked")}</p>
            {state.submittedVia === "native" && (
              <p className="text-sm text-muted-foreground">{t("projectNativeOnly")}</p>
            )}
            {pending ? (
              <p className="text-sm" role="status">
                {t("projectRequestPending")}
              </p>
            ) : null}
          </div>
        ) : state?.submittedAt || state?.status === "not_submitted" ? (
          <div className="mb-6 space-y-2">
            {state.submittedAt && <p className="text-sm">{t("projectReopened")}</p>}
            {state.status === "not_submitted" && (
              <p className="text-sm">{t("projectNotSubmitted")}</p>
            )}
          </div>
        ) : null}
        {state && (state.membershipDiffers || state.unresolvedCount > 0) && (
          <div className="mb-6 space-y-4">
            <h3 className="font-medium text-balance">{t("projectParticipantsDiffer")}</h3>
            <ParticipantDifference state={state} />
            {state.unresolvedCount > 0 && (
              <p className="text-sm text-pretty">
                {t("projectIdentityPending")}{" "}
                <Link className="underline" href="/settings/profile">
                  {t("myProfile")}
                </Link>
              </p>
            )}
          </div>
        )}
        {state?.teamSizeViolation && (
          <p className="mb-6 text-sm text-destructive">
            {t(state.unresolvedCount ? "projectPossibleTeamSize" : "projectTeamSizeViolation")}
          </p>
        )}
        <div className="space-y-3">
          <h3 className="font-medium text-balance">{t("projectDevpostOptional")}</h3>
          {displayCode && (
            <div className="space-y-3">
              <p className="text-sm text-pretty">
                {t("projectDevpostCode", { code: displayCode })}
              </p>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <code className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm font-medium tabular-nums">
                  {displayCode}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setCopyError(null);
                    try {
                      await navigator.clipboard.writeText(displayCode);
                      setCopied(true);
                    } catch {
                      setCopyError(t("projectCopyFailed"));
                    }
                  }}
                >
                  <CopyIcon aria-hidden="true" />
                  {t("projectCopyCode")}
                </Button>
                <span className="text-sm text-muted-foreground" role="status">
                  {copied ? t("projectCopiedCode") : ""}
                </span>
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {t(state?.devpostUrl ? "projectDevpostLinked" : "projectDevpostUnlinked")}
          </p>
          {copyError && <ContextualError message={copyError} />}
          {state?.devpostUrl && state.internal.length === 0 && (
            <ImportedProjectClaim
              state={state}
              onChanged={async () => {
                await load();
                await onChanged();
              }}
            />
          )}
        </div>
        {!state?.lockedAt && (
          <>
            <div className="my-6 flex items-center gap-3 text-sm text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t("projectOr")}
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground text-pretty">
                {t("projectSubmitConfirm")}
              </p>
              <Button
                variant="outline"
                disabled={busy || !canSubmit || (stage === "projects" && !state?.canSubmit)}
                onClick={() => {
                  setError(null);
                  setConfirm(true);
                }}
              >
                {t("submitProjectNative")}
              </Button>
            </div>
          </>
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
        title={t("submitProjectNative")}
        description={t("projectSubmitConfirm")}
        confirmLabel={t("submitProjectNative")}
        cancelLabel={t("cancel")}
        pending={busy}
        onConfirm={async () => {
          if (await mutate(() => submitProject(id, stage))) setConfirm(false);
        }}
      >
        <p className="text-sm font-medium wrap-break-word">{name}</p>
        {error && <ContextualError message={error} />}
      </AlertModal>
    </div>
  );
}
export function ImportedProjectClaim({
  state,
  onChanged,
}: {
  state: ProjectSubmission;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  useEffect(() => {
    projectLinkCandidates(state.id)
      .then((r) => setCandidates(r.groups))
      .catch((e) => setError(e instanceof ApiError ? e.message : t("couldNotLoadProjects")));
  }, [state.id, t]);
  if (state.claimStatus === "confirmed" || state.claimStatus === "rejected") return null;
  async function claim(groupId?: number, kind: "group" | "repo" = "group") {
    setBusy(true);
    setError(null);
    try {
      const result = await claimProject(state.id, groupId, false, kind);
      if (result.repoId) {
        router.replace(`/my-project/projects/${result.repoId}`);
        return;
      }
      await onChanged();
      setReview(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("couldNotSaveProject"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm">{t("projectClaimIntro")}</p>
      <ActionGroup className="[&>button]:grow sm:[&>button]:grow-0">
        <Button loading={busy} onClick={() => claim()}>
          {t("projectConfirmNew")}
        </Button>
        {candidates.length > 0 && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setError(null);
              setReview(true);
            }}
          >
            {t("projectLinkExisting")}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post(
                `/api/me/projects/${state.id}/reject-claim`,
                {},
                { headers: { "Idempotency-Key": crypto.randomUUID() } },
              );
              router.replace("/my-project");
            } catch (e) {
              setError(e instanceof ApiError ? e.message : t("couldNotSaveProject"));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("projectNotMine")}
        </Button>
      </ActionGroup>
      <SidePanelEditor open={review} onOpenChange={setReview} title={t("projectLinkExisting")}>
        <div className="space-y-6">
          <SectionCard title={t("projectDevpostParticipants")}>
            <p className="font-medium text-sm wrap-break-word">{state.name}</p>
            <ParticipantList members={state.external} />
          </SectionCard>
          <div className="divide-y divide-border">
            {candidates.map((c) => {
              const ids = [...new Set(state.external.map((m) => m.userId))].sort();
              const target = c.members.map((m) => m.userId).sort();
              const differs =
                state.unresolvedCount > 0 || JSON.stringify(ids) !== JSON.stringify(target);
              return (
                <div className="space-y-3 py-4" key={`${c.kind ?? "group"}:${c.id}`}>
                  <h3 className="font-medium">{c.name}</h3>
                  <ParticipantList members={c.members} />
                  {differs ? (
                    <p className="text-sm">{t("projectLinkConflict")}</p>
                  ) : (
                    <Button disabled={busy} loading={busy} onClick={() => claim(c.id, c.kind)}>
                      {t("projectLink")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {error && <ContextualError message={error} />}
        </div>
      </SidePanelEditor>
      {error && !review && <ContextualError message={error} />}
    </div>
  );
}
