"use client";

// H18 report inbox: attendee reports of projects and public profiles, closed by organisers.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { FlagIcon } from "@phosphor-icons/react/dist/csr/Flag";
import Link from "next/link";
import { useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { shortDateTimeFmt } from "@/lib/datetime";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";

type Status = "open" | "actioned" | "dismissed" | "all";
type Person = { id: number; name: string | null; surname: string | null };
interface Report {
  id: number;
  kind: "project" | "profile";
  reason: "inappropriate" | "harassment" | "spam" | "other";
  details: string | null;
  status: "open" | "actioned" | "dismissed";
  createdAt: string;
  reporter: Person;
  project: { id: number; name: string } | null;
  person: Person | null;
}

const REASON_KEY: Record<Report["reason"], MessageKey> = {
  inappropriate: "reportReasonInappropriate",
  harassment: "reportReasonHarassment",
  spam: "reportReasonSpam",
  other: "reportReasonOther",
};
const STATUS_KEY: Record<Status, MessageKey> = {
  open: "reportStatusOpen",
  actioned: "reportStatusActioned",
  dismissed: "reportStatusDismissed",
  all: "reportStatusAll",
};

const personName = (person: Person) =>
  [person.name, person.surname].filter(Boolean).join(" ") || `#${person.id}`;

export default function ReportsPage() {
  const { t } = useLocale();
  const { can } = useSessionContext();
  const allowed = can(CAPABILITIES.USERS_WRITE) || can(CAPABILITIES.PROJECTS_EDIT);
  const [status, setStatus] = useState<Status>("open");
  const [busy, setBusy] = useState<number | null>(null);
  const reports = useServerResource(
    ["content-reports", status],
    (signal) => api.get<{ items: Report[] }>(`/api/content-reports?status=${status}`, { signal }),
    { enabled: allowed },
  );
  if (!allowed) return <AccessDenied ask={t("reportsAccessDeniedDesc")} />;

  async function close(report: Report, next: "actioned" | "dismissed") {
    setBusy(report.id);
    try {
      await api.patch(`/api/content-reports/${report.id}`, { status: next });
      reports.reload();
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotCloseReport")), t("toastReports"));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<Report>[] = [
    {
      id: "reported",
      header: t("colReported"),
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary">
            {t(r.kind === "project" ? "reportKindProject" : "reportKindProfile")}
          </Badge>
          {r.project ? (
            <Link href={`/projects/${r.project.id}`} className="truncate text-sm hover:underline">
              {r.project.name}
            </Link>
          ) : r.person ? (
            <Link href={`/users/${r.person.id}`} className="truncate text-sm hover:underline">
              {personName(r.person)}
            </Link>
          ) : null}
        </div>
      ),
    },
    {
      id: "reason",
      header: t("colReason"),
      cell: (r) => (
        <div className="min-w-0 space-y-0.5">
          <span className="text-sm">{t(REASON_KEY[r.reason])}</span>
          {r.details ? (
            <p className="text-muted-foreground text-xs break-words">{r.details}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "reporter",
      header: t("colReporter"),
      cell: (r) => (
        <Link href={`/users/${r.reporter.id}`} className="text-sm hover:underline">
          {personName(r.reporter)}
        </Link>
      ),
    },
    {
      id: "when",
      header: t("colWhen"),
      cell: (r) => (
        <span className="text-sm">{shortDateTimeFmt.format(new Date(r.createdAt))}</span>
      ),
    },
    {
      id: "state",
      header: t("colStatus"),
      cell: (r) =>
        r.status === "open" ? (
          <div className="flex gap-2">
            <Button size="sm" disabled={busy === r.id} onClick={() => void close(r, "actioned")}>
              {t("reportMarkHandled")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === r.id}
              onClick={() => void close(r, "dismissed")}
            >
              {t("dismiss")}
            </Button>
          </div>
        ) : (
          <Badge variant="outline">{t(STATUS_KEY[r.status])}</Badge>
        ),
    },
  ];

  return (
    <PageLayout>
      <PageHeader
        title={t("contentReports")}
        actions={
          <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
            <SelectTrigger className="w-40" aria-label={t("colStatus")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_KEY) as Status[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(STATUS_KEY[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <DataTable
        columns={columns}
        data={reports.data?.items ?? []}
        getRowId={(r) => String(r.id)}
        stateKey="content-reports"
        loading={reports.loading && !reports.data}
        error={
          reports.error
            ? {
                message: apiErrorText(reports.error, t, t("couldNotLoadReports")),
                onRetry: reports.reload,
              }
            : undefined
        }
        getRowLabel={(r) => `${t(REASON_KEY[r.reason])} #${r.id}`}
        empty={{ icon: FlagIcon, title: t("noReportsTitle") }}
      />
    </PageLayout>
  );
}
