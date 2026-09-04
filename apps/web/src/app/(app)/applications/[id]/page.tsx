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
import { EVENTS } from "@hackos/shared/events";
import { ClipboardListIcon, LockIcon, UsersIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackLink } from "@/components/common/back-link";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import {
  confirmDiscardUnsavedChanges,
  useUnsavedChangesGuard,
} from "@/lib/use-unsaved-changes-guard";
import {
  type ApplicationForm,
  type ApplicationStats,
  grantedRoleNameLabel,
  windowState,
} from "../lib";

import { MetadataCard } from "./metadata-card";
import { QuestionsCard } from "./questions-card";
import { ResponsesTab } from "./responses-tab";

export default function ApplicationDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  // H57: a reviewer can see the outbox/sent rows read-only, not just deciders —
  // ResponsesTab/ReviewModal independently gate every actual action on canDecide.
  const canSeeDecisions = canReview || canDecide;
  const applicationTabs = [
    "overview",
    canManage ? "builder" : null,
    canReview ? "review" : null,
    canSeeDecisions ? "outbox" : null,
    canSeeDecisions ? "sent" : null,
  ].filter(
    (value): value is "overview" | "builder" | "review" | "outbox" | "sent" => value !== null,
  );
  const defaultTab = "overview" as const;
  const { tab, setTab } = useUrlTab({ values: applicationTabs, defaultValue: defaultTab });

  const [form, setForm] = useState<ApplicationForm | null>(null);
  const [stats, setStats] = useState<ApplicationStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const loadedFormIdRef = useRef<number | null>(null);

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

  function changeTab(next: string) {
    if (!isApplicationTab(next) || next === tab) return;
    if (tab === "builder" && builderDirty && !confirmDiscardUnsavedChanges(true, t)) return;
    setTab(next);
  }

  const loadForm = useCallback(async () => {
    try {
      // H11-H14: every application workspace uses the protected metadata
      // endpoint. This lets decision-only staff open a closed form without
      // granting the builder's update controls.
      const data = await api.get<ApplicationForm>(`/api/applications/${id}`);
      setForm(data);
      loadedFormIdRef.current = id;
      setState("ready");
    } catch (err) {
      // A live refresh is background revalidation: keep the last complete
      // application shell when it fails, so stats, tabs, and the active list
      // never disappear for a transient network error.
      if (loadedFormIdRef.current !== id) {
        setErrorMsg(err instanceof ApiError ? err.message : t("couldNotLoadForm"));
        setState("error");
      }
    }
  }, [id, t]);

  // Soft, in-place refresh instead of a hard reload when someone else edits
  // this form, its questions, or a response changes its stats elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=applications", [
    EVENTS.DOMAIN_CHANGED,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching the application form by id from the API on mount is a legitimate external-system sync
    if (Number.isFinite(id)) void loadForm();
    else setState("error");
  }, [id, loadForm, liveRefresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (!canStats || !Number.isFinite(id)) return;
    api
      .get<ApplicationStats>(`/api/applications/${id}/stats`)
      .then(setStats)
      // Keep the last complete stats strip during background revalidation.
      .catch(() => {});
  }, [id, canStats, liveRefresh]);

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-6">
        <BackLink href="/applications" label={t("backToApplications")} />
        <EmptyState
          icon={ClipboardListIcon}
          title={t("formNotFound")}
          description={errorMsg || t("formCouldNotBeLoaded")}
        />
      </div>
    );
  }

  const w = form ? windowState(form, t) : null;

  return (
    <div className="space-y-6">
      <BackLink href="/applications" label={t("backToApplications")} />

      <PageHeader
        title={form ? form.name : t("applicationNumber", { id })}
        state={
          form && w ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="neutral">
                {grantedRoleNameLabel(form.granted_role_name, t)}
              </StatusBadge>
              <StatusBadge tone={w.tone} dot={false}>
                {w.label}
              </StatusBadge>
              {/* Form settings and Questions save independently (two buttons,
                  two local statuses) — this aggregate keeps either one's
                  unsaved edit visible even while looking at the other card,
                  or after switching away to a different tab. */}
              {builderDirty && <SaveStatus state="unsaved" />}
            </div>
          ) : undefined
        }
        meta={
          form?.capacity != null ? (
            <span className="text-muted-foreground text-xs">
              {t("quotaInline", { capacity: form.capacity })}
            </span>
          ) : undefined
        }
      />

      {canStats && stats && <StatsStrip stats={stats} />}

      {applicationTabs.length > 0 && (
        <Tabs value={tab} onValueChange={changeTab}>
          <TabBar className="w-full justify-start">
            <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
            {canManage && <TabsTrigger value="builder">{t("formTabLabel")}</TabsTrigger>}
            {canReview && <TabsTrigger value="review">{t("review")}</TabsTrigger>}
            {canSeeDecisions && <TabsTrigger value="outbox">{t("workspaceOutbox")}</TabsTrigger>}
            {canSeeDecisions && (
              <TabsTrigger value="sent">{t("workspaceSentDecisions")}</TabsTrigger>
            )}
          </TabBar>

          <TabsContent value="overview" className="pt-2">
            <SectionCard title={t("applicationOverviewTitle")} icon={ClipboardListIcon}>
              {form ? (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground text-sm">{t("colGrantedRole")}</dt>
                    <dd className="mt-1 font-medium">
                      {grantedRoleNameLabel(form.granted_role_name, t)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-sm">{t("statusColumn")}</dt>
                    <dd className="mt-1 font-medium">{w?.label ?? t("unknownStatus")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-sm">
                      {t("applicationQuestionsLabel")}
                    </dt>
                    <dd className="mt-1 font-medium">{form.template.length}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-sm">
                      {t("applicationCapacityLabel")}
                    </dt>
                    <dd className="mt-1 font-medium">{form.capacity ?? t("unlimited")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-sm">{t("askShirtSizeLabel")}</dt>
                    <dd className="mt-1 font-medium">
                      {form.ask_shirt_size ? t("yesLabel") : t("noLabel")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-sm">
                      {t("askFoodIntolerancesLabel")}
                    </dt>
                    <dd className="mt-1 font-medium">
                      {form.ask_food_intolerances ? t("yesLabel") : t("noLabel")}
                    </dd>
                  </div>
                </dl>
              ) : (
                <EmptyState icon={LockIcon} title={t("metadataUnavailable")} />
              )}
            </SectionCard>
          </TabsContent>

          {canManage && (
            <TabsContent value="builder" className="space-y-6 pt-2">
              {form ? (
                <>
                  <MetadataCard form={form} onSaved={loadForm} onDirtyChange={setMetadataDirty} />
                  <QuestionsCard form={form} onSaved={loadForm} onDirtyChange={setQuestionsDirty} />
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
                workspace="sent"
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

function StatsStrip({ stats }: { stats: ApplicationStats }) {
  const { t } = useLocale();
  const c = stats.counts_by_status;
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
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t("responsesLabel")}
        value={String(nonDraft)}
        icon={UsersIcon}
        hint={t("nonDraftHint")}
      />
      <StatCard
        label={t("acceptedLabel")}
        value={String(accepted)}
        hint={t("unsentSentHint", { unsent: acceptedUnsent, sent: acceptedSent })}
      />
      <StatCard label={t("confirmed")} value={String(c.confirmed ?? 0)} />
      <StatCard
        label={t("declined")}
        value={String(declined)}
        hint={t("declinedHint", {
          unsent: declinedUnsent,
          sent: declinedSent,
          declined: c.declined ?? 0,
          expired: c.expired ?? 0,
        })}
      />
    </div>
  );
}
