"use client";

// Participant "My applications" landing (H12, H14): the authenticated user sees
// every response they've started/submitted (with its masked status) plus the
// open forms they haven't applied to yet. No capability gate — every user.
//
// Data:
//   GET /api/me/applications      → { responses } (my responses, masked status)
//   GET /api/public/applications  → { applications } (open forms w/ template)

import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import Link from "next/link";
import { useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatEventDate } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import {
  formTypeLabel,
  type MyResponseSummary,
  type PublicForm,
  statusLabel,
  statusTone,
} from "./lib";

export default function MyApplicationsPage() {
  const { t, language } = useLocale();
  const mine = useLiveQuery(
    (signal) => api.get<{ responses: MyResponseSummary[] }>("/api/me/applications", { signal }),
    domainScope(SSE_TOPICS.APPLICATIONS),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["me-applications"] },
  );
  const open = useLiveQuery(
    (signal) => api.get<{ applications: PublicForm[] }>("/api/public/applications", { signal }),
    domainScope(SSE_TOPICS.APPLICATIONS),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["public-applications"] },
  );
  const responses = mine.data?.responses ?? [];
  const forms = open.data?.applications ?? [];
  const loading = (mine.loading && !mine.data) || (open.loading && !open.data);
  const responsesError = mine.error
    ? apiErrorText(mine.error, t, t("couldNotLoadYourApplications"))
    : null;
  const formsError = open.error
    ? apiErrorText(open.error, t, t("couldNotLoadYourApplications"))
    : null;
  const [deleting, setDeleting] = useState(false);
  const [draftToDelete, setDraftToDelete] = useState<MyResponseSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteDraft() {
    if (!draftToDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/applications/${draftToDelete.application_id}/response`);
      mine.refetch();
      setDraftToDelete(null);
    } catch (error) {
      setDeleteError(apiErrorText(error, t, t("couldNotDeleteApplicationDraft")));
    } finally {
      setDeleting(false);
    }
  }

  // Open forms I haven't started a response for yet.
  const applied = new Set(responses.map((r) => r.application_id));
  const openToApply = forms.filter((f) => !applied.has(f.id));

  if (loading) {
    return (
      <PageLayout aria-busy="true">
        <PageHeader title={t("myApplications")} />
        <div role="status" className="space-y-4">
          <span className="sr-only">{t("loading")}</span>
          <div className="h-28 animate-pulse rounded-lg border bg-muted/50 motion-reduce:animate-none" />
          <div className="h-28 animate-pulse rounded-lg border bg-muted/50 motion-reduce:animate-none" />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader title={t("myApplications")} />
      <AlertModal
        open={draftToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setDraftToDelete(null);
        }}
        title={t("deleteApplicationDraft")}
        description={t("deleteApplicationDraftDescription", {
          name: draftToDelete?.application_name ?? "",
        })}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteApplicationDraft")}
        destructive
        pending={deleting}
        onConfirm={() => void deleteDraft()}
      >
        {deleteError && (
          <ContextualError
            message={deleteError}
            onRetry={deleting ? undefined : () => void deleteDraft()}
          />
        )}
      </AlertModal>

      <SectionCard
        title={t("myResponses")}
        state={<span className="type-meta tabular-nums">{responses.length}</span>}
        bodyClassName={responses.length === 0 && !responsesError ? "p-0" : "space-y-2"}
      >
        {responsesError ? (
          <ContextualError message={responsesError} onRetry={() => mine.refetch()} />
        ) : responses.length === 0 ? (
          <EmptyState title={t("notAppliedYetTitle")} description={t("notAppliedYetDesc")} />
        ) : (
          responses.map((r) => (
            <div
              key={r.id}
              className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border px-4 py-3"
            >
              <Link
                href={`/my-applications/${r.application_id}`}
                className="hover:bg-muted/50 flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 rounded-control focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="text-pretty font-medium">{r.application_name}</div>
                  <div className="text-muted-foreground text-xs">
                    {r.submitted_at
                      ? t("submittedOnPrefix", {
                          date: formatEventDate(r.submitted_at, language, "dateTime"),
                        })
                      : t("notSubmittedYet")}
                  </div>
                </div>
                {!r.can_delete_draft && (
                  <StatusBadge className="shrink-0" tone={statusTone(r.status)} dot={false}>
                    {statusLabel(r.status, t)}
                  </StatusBadge>
                )}
              </Link>
              {r.can_delete_draft && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDeleteError(null);
                    setDraftToDelete(r);
                  }}
                >
                  {t("deleteApplicationDraft")}
                </Button>
              )}
            </div>
          ))
        )}
      </SectionCard>

      <SectionCard
        title={t("openToApply")}
        state={<span className="type-meta tabular-nums">{openToApply.length}</span>}
        bodyClassName={openToApply.length === 0 && !formsError ? "p-0" : "space-y-2"}
      >
        {formsError ? (
          <ContextualError message={formsError} onRetry={() => open.refetch()} />
        ) : openToApply.length === 0 ? (
          <EmptyState title={t("noOpenFormsTitle")} description={t("noOpenFormsDesc")} />
        ) : (
          openToApply.map((f) => (
            <div
              key={f.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-pretty font-medium">{f.name}</div>
                <div className="text-muted-foreground text-xs">
                  <span>{formTypeLabel(f.granted_role_name, t)}</span>
                  {f.close_at
                    ? t("closesInline", { date: formatEventDate(f.close_at, language, "dateTime") })
                    : ""}
                </div>
              </div>
              <Button asChild size="sm" className="w-full sm:w-auto">
                <Link href={`/my-applications/${f.id}`}>{t("apply")}</Link>
              </Button>
            </div>
          ))
        )}
      </SectionCard>
    </PageLayout>
  );
}
