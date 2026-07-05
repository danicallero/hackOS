"use client";

// Participant "My applications" landing (H12, H14): the authenticated user sees
// every response they've started/submitted (with its masked status) plus the
// open forms they haven't applied to yet. No capability gate — every user.
//
// Data:
//   GET /api/me/applications      → { responses } (my responses, masked status)
//   GET /api/public/applications  → { applications } (open forms w/ template)

import { ClipboardListIcon, FilePlus2Icon, InboxIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import {
  fmtDateTime,
  type MyResponseSummary,
  type PublicForm,
  statusLabel,
  statusTone,
} from "./lib";

export default function MyApplicationsPage() {
  const [responses, setResponses] = useState<MyResponseSummary[]>([]);
  const [forms, setForms] = useState<PublicForm[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mine, open] = await Promise.all([
        api.get<{ responses: MyResponseSummary[] }>("/api/me/applications"),
        api.get<{ applications: PublicForm[] }>("/api/public/applications"),
      ]);
      setResponses(mine.responses);
      setForms(open.applications);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load your applications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Open forms I haven't started a response for yet.
  const applied = new Set(responses.map((r) => r.application_id));
  const openToApply = forms.filter((f) => !applied.has(f.id));

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="My applications" />
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My applications"
        description="Track the forms you've applied to, finish any drafts, and confirm your place once you're accepted."
      />

      <SectionCard
        icon={ClipboardListIcon}
        title="My responses"
        description="Everything you've started or submitted, with its current status."
        bodyClassName={responses.length === 0 ? "p-0" : "space-y-2"}
      >
        {responses.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="You haven't applied to anything yet"
            description="Open forms you can apply to are listed below."
          />
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
                    ? `Submitted ${fmtDateTime(r.submitted_at)}`
                    : "Not submitted yet"}
                </div>
              </div>
              <StatusBadge tone={statusTone(r.status)} dot={false}>
                {statusLabel(r.status)}
              </StatusBadge>
            </Link>
          ))
        )}
      </SectionCard>

      <SectionCard
        icon={FilePlus2Icon}
        title="Open to apply"
        description="Forms currently accepting new applications."
        bodyClassName={openToApply.length === 0 ? "p-0" : "space-y-2"}
      >
        {openToApply.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="No open forms right now"
            description="Check back later — new application windows will show up here."
          />
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
                  {f.close_at ? ` · closes ${fmtDateTime(f.close_at)}` : ""}
                </div>
              </div>
              <Button asChild size="sm">
                <Link href={`/my-applications/${f.id}`}>Apply</Link>
              </Button>
            </div>
          ))
        )}
      </SectionCard>
    </div>
  );
}
