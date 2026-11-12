"use client";

// Application form detail (H11–H15, H57). Up to four tabs, gated per capability:
//   • Form (applications:manage) — edit metadata (window, quota, granted roles) and a
//     questions editor (add/remove/reorder template fields with i18n labels).
//     Persists via PATCH /api/applications/:id.
//   • Review (applications:review) — submitted responses: my-review score/
//     notes, shared staff-notes, and (for deciders) the accept/reject call.
//   • Outbox / Sent decisions (applications:review OR applications:decide) —
//     internal decisions not yet sent vs. every already-communicated final
//     status. A reviewer without applications:decide sees the same rows
//     read-only: ResponsesTab and ReviewModal both already gate every
//     send/resend/re-accept/revoke/confirm-override action strictly on
//     applications:decide, so widening tab *visibility* to reviewers doesn't
//     widen what they can do (H57). Optional stats strip needs logistics:stats.
//
// NOTE: the applications template uses templateFieldSchema (FIELD_KINDS), not
// the judging questionSchema. i18n labels carry {en,es,gl} (plan/07 §2).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { LockIcon } from "@phosphor-icons/react/dist/csr/Lock";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AlertModal } from "@/components/common/alert-modal";
import { BackLink } from "@/components/common/back-link";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SaveStatus } from "@/components/common/save-status";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { TabBar } from "@/components/common/tab-bar";
import { QuestionsCard } from "@/components/forms/questions-card";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLiveQuery } from "@/hooks/use-live-query";
import {
  confirmDiscardUnsavedChanges,
  useUnsavedChangesGuard,
} from "@/hooks/use-unsaved-changes-guard";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import {
  type ApplicationForm,
  type ApplicationStats,
  grantedRoleNameLabel,
  windowState,
} from "@/lib/applications";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { toast } from "@/lib/toast";
import { useUrlTab } from "@/lib/url-tab";
import { ApplicationDangerZone, MetadataCard } from "./metadata-card";
import { ResponsesTab } from "./responses-tab";

export default function ApplicationDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);

  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  // H57: a reviewer can see the outbox/sent rows read-only, not just deciders —
  // ResponsesTab/ReviewModal independently gate every actual action on canDecide.
  const canSeeDecisions = canReview || canDecide;
  const applicationTabs = [
    canManage ? "builder" : null,
    canReview ? "review" : null,
    canSeeDecisions ? "outbox" : null,
    canSeeDecisions ? "sent" : null,
  ].filter((value): value is "builder" | "review" | "outbox" | "sent" => value !== null);
  // Access to this page already requires one of manage/review/decide (nav.ts),
  // so applicationTabs is never empty — the first gated tab is a safe default.
  const responseRequested = useSearchParams().has("response");
  const defaultTab =
    responseRequested && canReview
      ? "review"
      : (applicationTabs[0] as (typeof applicationTabs)[number]);
  const { tab, setTab } = useUrlTab({ values: applicationTabs, defaultValue: defaultTab });

  // H11-H14: every application workspace uses the protected metadata endpoint.
  // This lets decision-only staff open a closed form without granting the
  // builder's update controls. A failed live refresh keeps the last complete
  // shell, so stats, tabs and the active list survive a transient error.
  const {
    data: form,
    error: formError,
    loading: formLoading,
    refetch: refetchForm,
  } = useLiveQuery(
    () => api.get<ApplicationForm>(`/api/applications/${id}`),
    domainScope(SSE_TOPICS.APPLICATIONS),
    [EVENTS.DOMAIN_CHANGED],
    { enabled: Number.isFinite(id), resourceKey: ["application", id, "form"] },
  );
  const loadForm = async () => refetchForm();
  const {
    data: stats,
    error: statsError,
    refetch: refetchStats,
  } = useLiveQuery(
    (signal) =>
      api.post<ApplicationStats>(
        "/api/statistics/query",
        { scopes: [`application:${id}`], panel_keys: ["overview"] },
        { signal },
      ),
    domainScope(SSE_TOPICS.APPLICATIONS),
    [EVENTS.DOMAIN_CHANGED],
    { enabled: canStats && Number.isFinite(id), resourceKey: ["application", id, "overview"] },
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // The builder (Form settings + Questions) is the only tab with local
  // unsaved edits — track both cards' dirtiness so leaving the page (or
  // switching to another tab) while either is dirty asks for confirmation
  // instead of silently discarding the draft, matching the event-settings
  // builder's guard.
  const metadataDirtyRef = useRef(false);
  const questionsDirtyRef = useRef(false);
  const [builderDirty, setBuilderDirty] = useState(false);
  const recomputeBuilderDirty = useCallback(() => {
    setBuilderDirty(metadataDirtyRef.current || questionsDirtyRef.current);
  }, []);
  const setMetadataDirty = useCallback(
    (dirty: boolean) => {
      metadataDirtyRef.current = dirty;
      recomputeBuilderDirty();
    },
    [recomputeBuilderDirty],
  );
  const setQuestionsDirty = useCallback(
    (dirty: boolean) => {
      questionsDirtyRef.current = dirty;
      recomputeBuilderDirty();
    },
    [recomputeBuilderDirty],
  );
  useUnsavedChangesGuard(builderDirty);

  function isApplicationTab(value: string): value is (typeof applicationTabs)[number] {
    return (applicationTabs as readonly string[]).includes(value);
  }

  async function changeTab(next: string) {
    if (!isApplicationTab(next) || next === tab) return;
    if (tab === "builder" && builderDirty) {
      if (!(await confirmDiscardUnsavedChanges(true))) return;
      metadataDirtyRef.current = false;
      questionsDirtyRef.current = false;
      flushSync(() => setBuilderDirty(false));
    }
    setTab(next);
  }

  if (Number.isFinite(id) && formLoading && !form) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!Number.isFinite(id) || (formError && !form)) {
    return (
      <div className="space-y-6">
        <EmptyState
          title={t("formNotFound")}
          description={
            formError
              ? apiErrorText(formError, t, t("couldNotLoadForm"))
              : t("formCouldNotBeLoaded")
          }
        />
      </div>
    );
  }

  const w = form ? windowState(form, t) : null;

  async function deleteForm() {
    setDeleting(true);
    try {
      await api.delete(`/api/applications/${id}`);
      router.push("/applications");
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotDeleteApplication")), t("deleteApplication"));
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageLayout>
      <PageHeader
        context={<BackLink href="/applications" label={t("applications")} />}
        title={form ? form.name : t("applicationNumber", { id })}
        state={
          form && w ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={w.tone}>{w.label}</StatusBadge>
              {/* Form settings and Questions save independently (two buttons,
                  two local statuses) — this aggregate keeps either one's
                  unsaved edit visible even while looking at the other card,
                  or after switching away to a different tab. */}
              {builderDirty && tab !== "builder" && <SaveStatus state="unsaved" />}
            </div>
          ) : undefined
        }
        meta={
          form ? (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t("colGrantedRole")}</dt>
                <dd className="font-medium">{grantedRoleNameLabel(form.granted_role_name, t)}</dd>
              </div>
              {form.capacity != null && (
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">{t("colQuota")}</dt>
                  <dd className="font-medium tabular-nums">{form.capacity}</dd>
                </div>
              )}
            </dl>
          ) : undefined
        }
      />

      <AlertModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteApplication")}
        description={t("deleteApplicationWarning")}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteAction")}
        destructive
        pending={deleting}
        onConfirm={() => void deleteForm()}
      />

      {canStats && Boolean(statsError) && (
        <ContextualError
          message={apiErrorText(statsError, t, t("couldNotLoadStatistics"))}
          onRetry={() => refetchStats()}
        />
      )}
      {canStats && stats?.counts_by_status && <StatsStrip stats={stats} />}

      {applicationTabs.length > 0 && (
        <Tabs value={tab} onValueChange={changeTab}>
          <TabBar>
            {canManage && <TabsTrigger value="builder">{t("formTabLabel")}</TabsTrigger>}
            {canReview && <TabsTrigger value="review">{t("review")}</TabsTrigger>}
            {canSeeDecisions && <TabsTrigger value="outbox">{t("workspaceOutbox")}</TabsTrigger>}
            {canSeeDecisions && (
              <TabsTrigger value="sent">{t("workspaceSentDecisions")}</TabsTrigger>
            )}
          </TabBar>

          {canManage && (
            <TabsContent value="builder" className="max-w-(--page-width-content) space-y-6 pt-2">
              {form ? (
                <>
                  <MetadataCard form={form} onSaved={loadForm} onDirtyChange={setMetadataDirty} />
                  <QuestionsCard form={form} onSaved={loadForm} onDirtyChange={setQuestionsDirty} />
                  <ApplicationDangerZone onDelete={() => setDeleteOpen(true)} />
                </>
              ) : (
                <EmptyState
                  icon={LockIcon}
                  title={t("metadataUnavailable")}
                  description={t("metadataUnavailableDesc")}
                />
              )}
            </TabsContent>
          )}

          {canReview && (
            <TabsContent value="review" className="pt-2">
              <ResponsesTab
                id={id}
                template={form?.template ?? null}
                sections={form?.sections ?? []}
                askShirtSize={form?.ask_shirt_size ?? false}
                askFoodIntolerances={form?.ask_food_intolerances ?? false}
                reviewHiddenFields={form?.review_hidden_fields ?? []}
                onStandardViewSaved={loadForm}
                workspace="review"
              />
            </TabsContent>
          )}
          {canSeeDecisions && (
            <TabsContent value="outbox" className="pt-2">
              <ResponsesTab
                id={id}
                template={form?.template ?? null}
                sections={form?.sections ?? []}
                askShirtSize={form?.ask_shirt_size ?? false}
                askFoodIntolerances={form?.ask_food_intolerances ?? false}
                reviewHiddenFields={form?.review_hidden_fields ?? []}
                onStandardViewSaved={loadForm}
                workspace="outbox"
              />
            </TabsContent>
          )}
          {canSeeDecisions && (
            <TabsContent value="sent" className="pt-2">
              <ResponsesTab
                id={id}
                template={form?.template ?? null}
                sections={form?.sections ?? []}
                askShirtSize={form?.ask_shirt_size ?? false}
                askFoodIntolerances={form?.ask_food_intolerances ?? false}
                reviewHiddenFields={form?.review_hidden_fields ?? []}
                onStandardViewSaved={loadForm}
                workspace="sent"
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </PageLayout>
  );
}

function StatsStrip({ stats }: { stats: ApplicationStats }) {
  const { t } = useLocale();
  const c = stats.counts_by_status ?? {};
  const nonDraft = Object.entries(c)
    .filter(([s]) => s !== "draft")
    .reduce((a, [, v]) => a + v, 0);
  const accepted = (c.accepted_internal ?? 0) + (c.accepted ?? 0);
  const acceptedUnsent = c.accepted_internal ?? 0;
  const acceptedSent = c.accepted ?? 0;
  const declined =
    (c.rejected_internal ?? 0) + (c.rejected ?? 0) + (c.declined ?? 0) + (c.expired ?? 0);
  const declinedUnsent = c.rejected_internal ?? 0;
  const declinedSent = c.rejected ?? 0;
  // Sublines list only the non-zero parts; all-zero shows none.
  const joinHint = (parts: Array<string | null>) => parts.filter(Boolean).join(" · ") || undefined;
  const draftCount = stats.draft_count ?? 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t("responsesLabel")}
        value={String(nonDraft)}
        icon={UsersIcon}
        hint={draftCount > 0 ? t("nonDraftHint", { n: draftCount }) : undefined}
      />
      <StatCard
        label={t("acceptedLabel")}
        value={String(accepted)}
        hint={joinHint([
          acceptedUnsent > 0 ? t("statUnsentCount", { n: acceptedUnsent }) : null,
          acceptedSent > 0 ? t("statSentCount", { n: acceptedSent }) : null,
        ])}
      />
      <StatCard label={t("confirmed")} value={String(c.confirmed ?? 0)} />
      <StatCard
        label={t("declined")}
        value={String(declined)}
        hint={joinHint([
          declinedUnsent > 0 ? t("statUnsentCount", { n: declinedUnsent }) : null,
          declinedSent > 0 ? t("statSentCount", { n: declinedSent }) : null,
          (c.declined ?? 0) > 0 ? t("statDeclinedCount", { n: c.declined ?? 0 }) : null,
          (c.expired ?? 0) > 0 ? t("statExpiredCount", { n: c.expired ?? 0 }) : null,
        ])}
      />
    </div>
  );
}
