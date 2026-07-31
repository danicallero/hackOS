"use client";

// Application form detail (H11–H15). Up to four tabs, gated per capability:
//   • Form (applications:manage) — edit metadata (window, quota, type) and a
//     questions editor (add/remove/reorder template fields with i18n labels).
//     Persists via PATCH /api/applications/:id.
//   • Review (applications:review) — submitted responses: my-review score/
//     notes, shared staff-notes, and (for deciders) the accept/reject call.
//   • Outbox / Sent decisions (applications:decide) — internal decisions not
//     yet sent vs. every already-communicated final status, with
//     send/resend/re-accept/revoke/confirm-override actions gated by each
//     row's actual status (see ../workflow.ts). Optional stats strip needs
//     logistics:stats.
//
// NOTE: the applications template uses templateFieldSchema (FIELD_KINDS), not
// the judging questionSchema. i18n labels carry {en,es,gl} (plan/07 §2).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { ClipboardListIcon, LockIcon, UsersIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BackLink } from "@/components/common/back-link";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { type ApplicationForm, type ApplicationStats, windowState } from "../lib";
import { defaultApplicationWorkspace } from "../workflow";

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

  const [form, setForm] = useState<ApplicationForm | null>(null);
  const [stats, setStats] = useState<ApplicationStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const loadForm = useCallback(async () => {
    try {
      // H11-H14: every application workspace uses the protected metadata
      // endpoint. This lets decision-only staff open a closed form without
      // granting the builder's update controls.
      const data = await api.get<ApplicationForm>(`/api/applications/${id}`);
      setForm(data);
      setState("ready");
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : t("couldNotLoadForm"));
      setState("error");
    }
  }, [id, t]);

  // Soft, in-place refresh instead of a hard reload when someone else edits
  // this form, its questions, or a response changes its stats elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (Number.isFinite(id)) void loadForm();
    else setState("error");
  }, [id, loadForm, liveRefresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (!canStats || !Number.isFinite(id)) return;
    api
      .get<ApplicationStats>(`/api/applications/${id}/stats`)
      .then(setStats)
      .catch(() => setStats(null));
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

  const defaultTab = defaultApplicationWorkspace({
    manage: canManage,
    review: canReview,
    decide: canDecide,
  });
  const w = form ? windowState(form, t) : null;

  return (
    <div className="space-y-6">
      <BackLink href="/applications" label={t("backToApplications")} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {form ? form.name : t("applicationNumber", { id })}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {form && (
              <>
                <StatusBadge tone="neutral" className="capitalize">
                  {form.type}
                </StatusBadge>
                {w && (
                  <StatusBadge tone={w.tone} dot={false}>
                    {w.label}
                  </StatusBadge>
                )}
                {form.capacity != null && (
                  <span className="text-muted-foreground text-xs">
                    {t("quotaInline", { capacity: form.capacity })}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {canStats && stats && <StatsStrip stats={stats} />}

      {defaultTab && (
        <Tabs defaultValue={defaultTab}>
          <TabBar className="w-full justify-start">
            {canManage && <TabsTrigger value="builder">{t("formTabLabel")}</TabsTrigger>}
            {canReview && <TabsTrigger value="review">{t("workspaceReview")}</TabsTrigger>}
            {canDecide && <TabsTrigger value="outbox">{t("workspaceOutbox")}</TabsTrigger>}
            {canDecide && <TabsTrigger value="sent">{t("workspaceSentDecisions")}</TabsTrigger>}
          </TabBar>

          {canManage && (
            <TabsContent value="builder" className="space-y-6 pt-2">
              {form ? (
                <>
                  <MetadataCard form={form} onSaved={loadForm} />
                  <QuestionsCard form={form} onSaved={loadForm} />
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
              <ResponsesTab id={id} template={form?.template ?? null} workspace="review" />
            </TabsContent>
          )}
          {canDecide && (
            <TabsContent value="outbox" className="pt-2">
              <ResponsesTab id={id} template={form?.template ?? null} workspace="outbox" />
            </TabsContent>
          )}
          {canDecide && (
            <TabsContent value="sent" className="pt-2">
              <ResponsesTab id={id} template={form?.template ?? null} workspace="sent" />
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
