"use client";

// Participant "My applications" landing (H12, H14): the authenticated user sees
// every response they've started/submitted (with its masked status) plus the
// open forms they haven't applied to yet. No capability gate — every user.
//
// Data:
//   GET /api/me/applications      → { responses } (my responses, masked status)
//   GET /api/public/applications  → { applications } (open forms w/ template)

import { EVENTS } from "@hackos/shared/events";
import { ClipboardListIcon, FilePlus2Icon, InboxIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  fmtDateTime,
  formTypeLabel,
  type MyResponseSummary,
  type PublicForm,
  statusLabel,
  statusTone,
} from "./lib";

export default function MyApplicationsPage() {
  const { t, language } = useLocale();
  const [responses, setResponses] = useState<MyResponseSummary[]>([]);
  const [forms, setForms] = useState<PublicForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [responsesError, setResponsesError] = useState<string | null>(null);
  const [formsError, setFormsError] = useState<string | null>(null);

  // A background live-refresh shouldn't flash the whole page away — only
  // the very first load (before there's anything to show) should.
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    const [mine, open] = await Promise.allSettled([
      api.get<{ responses: MyResponseSummary[] }>("/api/me/applications"),
      api.get<{ applications: PublicForm[] }>("/api/public/applications"),
    ]);
    if (mine.status === "fulfilled") {
      setResponses(mine.value.responses);
      setResponsesError(null);
    } else {
      setResponsesError(
        mine.reason instanceof ApiError ? mine.reason.message : t("couldNotLoadYourApplications"),
      );
    }
    if (open.status === "fulfilled") {
      setForms(open.value.applications);
      setFormsError(null);
    } else {
      setFormsError(
        open.reason instanceof ApiError ? open.reason.message : t("couldNotLoadYourApplications"),
      );
    }
    hasLoadedRef.current =
      hasLoadedRef.current || mine.status === "fulfilled" || open.status === "fulfilled";
    setLoading(false);
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when staff decides on
  // one of your applications elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=applications", [
    EVENTS.DOMAIN_CHANGED,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetching applications from API (external-system sync)
    load();
  }, [load, liveRefresh]);

  // Open forms I haven't started a response for yet.
  const applied = new Set(responses.map((r) => r.application_id));
  const openToApply = forms.filter((f) => !applied.has(f.id));

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title={t("myApplications")} />
        <div role="status" className="space-y-4">
          <span className="sr-only">{t("loading")}</span>
          <div className="h-28 animate-pulse rounded-lg border bg-muted/50 motion-reduce:animate-none" />
          <div className="h-28 animate-pulse rounded-lg border bg-muted/50 motion-reduce:animate-none" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("myApplications")} />

      <SectionCard
        icon={ClipboardListIcon}
        title={t("myResponses")}
        state={<span className="type-meta tabular-nums">{responses.length}</span>}
        bodyClassName={responses.length === 0 && !responsesError ? "p-0" : "space-y-2"}
      >
        {responsesError ? (
          <ContextualError message={responsesError} onRetry={() => void load()} />
        ) : responses.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title={t("notAppliedYetTitle")}
            description={t("notAppliedYetDesc")}
          />
        ) : (
          responses.map((r) => (
            <Link
              key={r.id}
              href={`/my-applications/${r.application_id}`}
              className="hover:bg-muted/50 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-pretty font-medium">{r.application_name}</div>
                <div className="text-muted-foreground text-xs">
                  {r.submitted_at
                    ? t("submittedOnPrefix", { date: fmtDateTime(r.submitted_at, language) })
                    : t("notSubmittedYet")}
                </div>
              </div>
              <StatusBadge className="shrink-0" tone={statusTone(r.status)} dot={false}>
                {statusLabel(r.status, t)}
              </StatusBadge>
            </Link>
          ))
        )}
      </SectionCard>

      <SectionCard
        icon={FilePlus2Icon}
        title={t("openToApply")}
        state={<span className="type-meta tabular-nums">{openToApply.length}</span>}
        bodyClassName={openToApply.length === 0 && !formsError ? "p-0" : "space-y-2"}
      >
        {formsError ? (
          <ContextualError message={formsError} onRetry={() => void load()} />
        ) : openToApply.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title={t("noOpenFormsTitle")}
            description={t("noOpenFormsDesc")}
          />
        ) : (
          openToApply.map((f) => (
            <div
              key={f.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-pretty font-medium">{f.name}</div>
                <div className="text-muted-foreground text-xs">
                  <span>{formTypeLabel(f.type, t)}</span>
                  {f.close_at ? t("closesInline", { date: fmtDateTime(f.close_at, language) }) : ""}
                </div>
              </div>
              <Button asChild size="sm" className="w-full sm:w-auto">
                <Link href={`/my-applications/${f.id}`}>{t("apply")}</Link>
              </Button>
            </div>
          ))
        )}
      </SectionCard>
    </div>
  );
}
