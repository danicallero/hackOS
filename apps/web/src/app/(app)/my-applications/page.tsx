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
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  fmtDateTime,
  type MyResponseSummary,
  type PublicForm,
  statusLabel,
  statusTone,
} from "./lib";

export default function MyApplicationsPage() {
  const { t } = useLocale();
  const [responses, setResponses] = useState<MyResponseSummary[]>([]);
  const [forms, setForms] = useState<PublicForm[]>([]);
  const [loading, setLoading] = useState(true);

  // A background live-refresh shouldn't flash the whole page away — only
  // the very first load (before there's anything to show) should.
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const [mine, open] = await Promise.all([
        api.get<{ responses: MyResponseSummary[] }>("/api/me/applications"),
        api.get<{ applications: PublicForm[] }>("/api/public/applications"),
      ]);
      setResponses(mine.responses);
      setForms(open.applications);
      hasLoadedRef.current = true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadYourApplications"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when staff decides on
  // one of your applications elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    load();
  }, [load, liveRefresh]);

  // Open forms I haven't started a response for yet.
  const applied = new Set(responses.map((r) => r.application_id));
  const openToApply = forms.filter((f) => !applied.has(f.id));

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("myApplications")} />
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
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
        bodyClassName={responses.length === 0 ? "p-0" : "space-y-2"}
      >
        {responses.length === 0 ? (
          <EmptyState icon={InboxIcon} title={t("notAppliedYetTitle")} />
        ) : (
          responses.map((r) => (
            <Link
              key={r.id}
              href={`/my-applications/${r.application_id}`}
              className="hover:bg-muted/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 transition-colors"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="truncate font-medium">{r.application_name}</div>
                <div className="text-muted-foreground text-xs">
                  {r.submitted_at
                    ? t("submittedOnPrefix", { date: fmtDateTime(r.submitted_at) })
                    : t("notSubmittedYet")}
                </div>
              </div>
              <StatusBadge tone={statusTone(r.status)} dot={false}>
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
        bodyClassName={openToApply.length === 0 ? "p-0" : "space-y-2"}
      >
        {openToApply.length === 0 ? (
          <EmptyState icon={InboxIcon} title={t("noOpenFormsTitle")} />
        ) : (
          openToApply.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="truncate font-medium">{f.name}</div>
                <div className="text-muted-foreground text-xs">
                  <span className="capitalize">{f.type}</span>
                  {f.close_at ? t("closesInline", { date: fmtDateTime(f.close_at) }) : ""}
                </div>
              </div>
              <Button asChild size="sm">
                <Link href={`/my-applications/${f.id}`}>{t("apply")}</Link>
              </Button>
            </div>
          ))
        )}
      </SectionCard>
    </div>
  );
}
