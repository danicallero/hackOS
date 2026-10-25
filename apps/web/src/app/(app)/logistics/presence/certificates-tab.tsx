"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { useState } from "react";
import { CertificatesPanel } from "@/components/certificates/certificates-panel";
import { IssueCertificateDialog } from "@/components/certificates/issue-certificate-dialog";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { Modal } from "@/components/common/modal";
import { Spinner } from "@/components/common/spinner";
import { AttendanceEvidenceExports } from "@/components/exports/attendance-evidence-exports";
import { PresenceTimeline } from "@/components/logistics/presence-timeline";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServerResource } from "@/hooks/use-server-resource";
import { api, apiDownload } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { type CertificateParticipant, certificatesApi } from "@/lib/certificates";
import { useLocale } from "@/lib/i18n";
import type { PresenceTimelineData } from "@/lib/logistics";
import { useCan } from "@/lib/session";

/** #1083: review awards against all evidence; university exports share the same hours. */
export function AttendanceCertificatesTab() {
  const { t } = useLocale();
  const canExport = useCan(CAPABILITIES.LOGISTICS_STATS);
  const roster = useServerResource(["certificate-participants"], certificatesApi.participants);
  const [university, setUniversity] = useState("");
  const [chosenStatus, setStatus] = useState<string | null>(null);
  const [person, setPerson] = useState<CertificateParticipant | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = roster.data?.items ?? [];
  const universities = [
    ...new Map(
      people
        .filter((p) => p.universityId != null)
        .map((p) => [
          p.universityId,
          { id: p.universityId as number, name: p.universityName ?? String(p.universityId) },
        ]),
    ).values(),
  ];
  // Pending reviews come first; with none waiting, show the people instead of an empty queue.
  const status =
    chosenStatus ??
    (people.some((p) => p.eligibility.reviewRequired) || roster.loading
      ? "review"
      : "participated");
  const filtered = people.filter(
    (p) =>
      (!university || p.universityId === Number(university)) &&
      (status === "all" ||
        (status === "review"
          ? p.eligibility.reviewRequired
          : status === "approved"
            ? p.eligibility.eligible
            : p.eligibility.hours > 0 || p.eligibility.approval)),
  );
  async function download(format: "general" | "udc") {
    setExporting(true);
    setError(null);
    try {
      const query = new URLSearchParams({ format });
      if (university) query.set("universityId", university);
      await apiDownload(
        `/api/certificates/participants/export.csv?${query}`,
        `attendance-${format}.csv`,
      );
    } catch (err) {
      setError(apiErrorText(err, t, t("couldNotLoadCertificates")));
    } finally {
      setExporting(false);
    }
  }
  const columns: Column<CertificateParticipant>[] = [
    {
      id: "name",
      header: t("columnUser"),
      cell: (p) => (
        <Button variant="link" onClick={() => setPerson(p)}>
          {[p.name, p.surname].filter(Boolean).join(" ")}
        </Button>
      ),
      sortValue: (p) => `${p.surname} ${p.name}`,
    },
    { id: "university", header: t("certificateUniversity"), cell: (p) => p.universityName ?? "—" },
    {
      id: "measured",
      header: t("certificateMeasuredHours"),
      align: "right",
      cell: (p) => <span className="tabular-nums">{p.eligibility.hours}</span>,
      sortValue: (p) => p.eligibility.hours,
    },
    {
      id: "certified",
      header: t("certificateCertifiedHours"),
      align: "right",
      cell: (p) => <span className="tabular-nums">{p.eligibility.certifiedHours ?? "—"}</span>,
      sortValue: (p) => p.eligibility.certifiedHours ?? -1,
    },
    {
      id: "status",
      header: t("statusColumn"),
      cell: (p) =>
        t(
          p.eligibility.approval
            ? "certificateManuallyApproved"
            : p.eligibility.eligible
              ? "certificateAutomaticApproval"
              : p.eligibility.reviewRequired
                ? "certificateAwaitingReview"
                : "certificateUnavailableByPolicy",
        ),
    },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full space-y-2 sm:w-72">
          <Label htmlFor="certificate-university">{t("certificateUniversity")}</Label>
          <EntityCombobox
            id="certificate-university"
            options={[{ id: 0, name: t("certificateAllUniversities") }, ...universities]}
            value={university || "0"}
            onChange={(id) => setUniversity(id === "0" ? "" : id)}
            getId={(u) => u.id}
            getLabel={(u) => u.name}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label={t("statusColumn")} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="review">{t("certificateAwaitingReview")}</SelectItem>
            <SelectItem value="approved">{t("certificateApprovedParticipants")}</SelectItem>
            <SelectItem value="participated">{t("certificateActualParticipants")}</SelectItem>
            <SelectItem value="all">{t("certificateAllParticipants")}</SelectItem>
          </SelectContent>
        </Select>
        {canExport && (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button variant="outline" disabled={exporting} onClick={() => void download("general")}>
              <DownloadSimpleIcon />
              {t("certificateAttendanceCsv")}
            </Button>
            <Button variant="outline" disabled={exporting} onClick={() => void download("udc")}>
              <DownloadSimpleIcon />
              {t("certificateUdcCsv")}
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <AttendanceEvidenceExports />
        <IssueCertificateDialog onIssued={roster.reload} />
      </div>
      {error && <ContextualError message={error} />}
      <p className="text-sm text-muted-foreground">{t("certificateExportScope")}</p>
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(p) => String(p.userId)}
        loading={roster.loading}
        searchable={(p) => `${p.name} ${p.surname} ${p.universityName}`}
        pageSize={20}
        error={
          roster.error
            ? {
                message: apiErrorText(roster.error, t, t("couldNotLoadCertificates")),
                onRetry: roster.reload,
              }
            : undefined
        }
      />
      <Modal
        open={person !== null}
        onOpenChange={(open) => !open && setPerson(null)}
        size="xl"
        title={person ? [person.name, person.surname].filter(Boolean).join(" ") : t("certificates")}
      >
        {person && (
          // On wide screens each column scrolls on its own, so the documents
          // never wait for the evidence list to reach its end.
          <div className="grid gap-6 lg:h-[min(70dvh,52rem)] lg:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="min-h-0 lg:overflow-y-auto lg:overscroll-contain">
              <CertificateEvidence key={person.userId} userId={person.userId} />
            </div>
            <div className="min-h-0 lg:overflow-y-auto lg:overscroll-contain">
              <CertificatesPanel
                key={`award-${person.userId}`}
                staffUserId={person.userId}
                onChanged={roster.reload}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CertificateEvidence({ userId }: { userId: number }) {
  const { t } = useLocale();
  const evidence = useServerResource(["certificate-evidence", userId], () =>
    api.get<PresenceTimelineData>(`/api/users/${userId}/certificate-evidence`),
  );
  if (evidence.error)
    return (
      <ContextualError
        message={apiErrorText(evidence.error, t, t("couldNotLoadCertificates"))}
        onRetry={evidence.reload}
      />
    );
  if (!evidence.data)
    return (
      <div role="status">
        <Spinner className="size-6" />
      </div>
    );
  return <PresenceTimeline data={evidence.data} />;
}
