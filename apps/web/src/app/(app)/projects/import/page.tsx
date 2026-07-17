"use client";

// Devpost import wizard (H16). Three phases on one page:
//   1. input   — upload or paste the two Devpost CSV exports (read client-side)
//   2. review  — POST .../preview (pure) renders the ImportPlan
//   3. done     — POST .../confirm (idempotent) applies it, shows the counts
// H18-H21 (create/edit projects in hackOS) are not backed by the API.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  FileTextIcon,
  LockIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { confirmImport, previewImport } from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import {
  type ConfirmResult,
  type ImportPlanView,
  matchLabel,
  matchTone,
  memberName,
  type PlanRepo,
  toImportPlanView,
} from "../shared";

// ── CSV picker (upload or paste; read as text client-side) ───────────────────

function CsvInput({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (text: string, fileName?: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function readFile(file: File) {
    try {
      const text = await file.text();
      setFileName(file.name);
      onChange(text, file.name);
    } catch {
      toast.error(t("couldNotReadFile", { file: file.name }));
    }
  }

  const lineCount = value ? value.trim().split(/\r?\n/).length : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {value ? (
          <StatusBadge tone="success">
            {fileName ?? t("pastedLabel")} · {t("rowsCount", { count: Math.max(0, lineCount - 1) })}
          </StatusBadge>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void readFile(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon className="size-4" />
          {t("chooseCsv")}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setFileName(null);
              onChange("");
            }}
          >
            {t("clear")}
          </Button>
        )}
      </div>
      <Textarea
        value={value}
        disabled={disabled}
        placeholder={t("pasteRawCsvPlaceholder")}
        className="h-28 font-mono text-xs"
        onChange={(e) => {
          setFileName(null);
          onChange(e.target.value);
        }}
      />
    </div>
  );
}

// ── preview repo table ───────────────────────────────────────────────────────

function repoUnmatched(repo: PlanRepo): number {
  return repo.members.filter((m) => m.matchType === "unmatched").length;
}

function buildRepoColumns(t: Translate): Column<PlanRepo>[] {
  return [
    {
      id: "title",
      header: t("colProject"),
      sortValue: (r) => r.title.toLowerCase(),
      cell: (r) => <span className="font-medium">{r.title}</span>,
    },
    {
      id: "action",
      header: t("colAction"),
      align: "center",
      sortValue: (r) => r.action,
      cell: (r) => (
        <StatusBadge tone={r.action === "create" ? "success" : "info"}>
          {r.action === "create" ? t("create") : t("update")}
        </StatusBadge>
      ),
    },
    {
      id: "team",
      header: t("colTeam"),
      align: "center",
      sortValue: (r) => r.members.length,
      cell: (r) => (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          <UsersIcon className="size-3.5" />
          {r.members.length}
        </span>
      ),
    },
    {
      id: "matched",
      header: t("colMembers"),
      align: "center",
      sortValue: (r) => repoUnmatched(r),
      cell: (r) => {
        const unmatched = repoUnmatched(r);
        if (r.members.length === 0) return <span className="text-muted-foreground text-sm">—</span>;
        return unmatched === 0 ? (
          <StatusBadge tone="success">{t("allMatched")}</StatusBadge>
        ) : (
          <StatusBadge tone="warning">{t("unmatchedCount", { count: unmatched })}</StatusBadge>
        );
      },
    },
    {
      id: "prizes",
      header: t("colPrizes"),
      sortValue: (r) => r.prizes.length,
      cell: (r) =>
        r.prizes.length === 0 ? (
          <span className="text-muted-foreground text-sm">—</span>
        ) : (
          <span className="text-muted-foreground text-sm">{r.prizes.length}</span>
        ),
    },
  ];
}

export default function ImportProjectsPage() {
  const { t } = useLocale();
  const { can } = useSessionContext();
  const canImport = can(CAPABILITIES.PROJECTS_IMPORT);
  const repoColumns = useMemo(() => buildRepoColumns(t), [t]);

  const [projectsCsv, setProjectsCsv] = useState("");
  const [participantsCsv, setParticipantsCsv] = useState("");
  const [plan, setPlan] = useState<ImportPlanView | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [detailRepo, setDetailRepo] = useState<PlanRepo | null>(null);
  // Stable idempotency key per previewed plan so a retry after a transient
  // error replays instead of double-importing (idempotency.ts contract).
  const idemKey = useRef<string | null>(null);

  const runPreview = useCallback(async () => {
    if (!projectsCsv.trim() || !participantsCsv.trim()) {
      toast.error(t("provideBothCsvExports"));
      return;
    }
    setPreviewing(true);
    try {
      const p = await previewImport(projectsCsv, participantsCsv);
      setPlan(toImportPlanView(p));
      idemKey.current = crypto.randomUUID();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotPreviewImport"));
    } finally {
      setPreviewing(false);
    }
  }, [projectsCsv, participantsCsv, t]);

  const runConfirm = useCallback(async () => {
    if (!plan) return;
    if (!idemKey.current) idemKey.current = crypto.randomUUID();
    setConfirming(true);
    try {
      const res = await confirmImport(projectsCsv, participantsCsv, idemKey.current);
      setResult(res as unknown as ConfirmResult);
      toast.success(t("importApplied"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotApplyImport"));
    } finally {
      setConfirming(false);
    }
  }, [plan, projectsCsv, participantsCsv, t]);

  function reset() {
    setPlan(null);
    setResult(null);
    idemKey.current = null;
  }

  if (!canImport) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("importFromDevpost")} />
        <EmptyState
          icon={LockIcon}
          title={t("noAccessImportProjects")}
          description={t("importDeniedDesc")}
        />
      </div>
    );
  }

  // ── phase 3: confirmed ─────────────────────────────────────────────────────
  if (result) {
    const c = result.counts;
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("importCompleteTitle")}
          description={t("batchInline", { id: result.batchId })}
        />
        <SectionCard
          title={t("importAppliedTitle")}
          description={t("devpostWrittenDesc")}
          icon={CheckCircle2Icon}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label={t("colProjectsCreated")} value={c.reposCreated} />
            <StatCard label={t("colProjectsUpdated")} value={c.reposUpdated} />
            <StatCard label={t("colMembersMatched")} value={c.participantsMatched} />
            <StatCard label={t("colMembersUnmatched")} value={c.participantsUnmatched} />
            <StatCard label={t("colPrizesSeen")} value={c.prizesSeen} />
          </div>
          {c.participantsUnmatched > 0 && (
            <p className="text-muted-foreground text-sm">
              {c.participantsUnmatched === 1
                ? t("participantsUnmatchedNoteOne", { count: c.participantsUnmatched })
                : t("participantsUnmatchedNoteOther", { count: c.participantsUnmatched })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/projects">{t("viewProjects")}</Link>
            </Button>
            {c.participantsUnmatched > 0 && (
              <Button asChild variant="outline">
                <Link href="/projects/unmatched">{t("resolveUnmatched")}</Link>
              </Button>
            )}
            <Button variant="ghost" onClick={reset}>
              {t("importAnother")}
            </Button>
          </div>
        </SectionCard>
      </div>
    );
  }

  // ── phase 2: review plan ───────────────────────────────────────────────────
  if (plan) {
    const totals = plan.totals;
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("reviewImport")}
          description={t("reviewImportDesc")}
          actions={
            <>
              <Button variant="outline" onClick={reset} disabled={confirming}>
                <ArrowLeftIcon className="size-4" />
                {t("back")}
              </Button>
              <SubmitButton type="button" pending={confirming} onClick={runConfirm}>
                {t("confirmImport")}
              </SubmitButton>
            </>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t("colProjectsLabel")}
            value={totals.repos}
            hint={t("newUpdateHint", { new: totals.reposToCreate, update: totals.reposToUpdate })}
          />
          <StatCard
            label={t("colMembers")}
            value={totals.members}
            hint={t("matchedUnmatchedHint", {
              matched: totals.membersMatched,
              unmatched: totals.membersUnmatched,
            })}
          />
          <StatCard label={t("prizesLabel")} value={totals.prizes} />
          <StatCard label={t("unassignedRows")} value={plan.unassignedParticipants.length} />
        </div>

        <DataTable
          columns={repoColumns}
          data={plan.repos}
          getRowId={(r) => `${r.title}::${r.url ?? ""}`}
          onRowClick={(r) => setDetailRepo(r)}
          getRowLabel={(r) => r.title}
          searchable={(r) => `${r.title} ${r.prizes.join(" ")}`}
          searchPlaceholder={t("searchProjectsPlaceholder")}
          pageSize={15}
          empty={{ icon: FileTextIcon, title: t("noProjectsParsed") }}
        />

        {plan.prizes.length > 0 && (
          <SectionCard title={t("prizesLabel")} description={t("devpostOptInPrizesDesc")}>
            <div className="flex flex-col gap-2">
              {plan.prizes.map((p) => (
                <div
                  key={p.name}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {p.repoCount === 1
                        ? t("projectCountOne", { count: p.repoCount })
                        : t("projectCountOther", { count: p.repoCount })}
                    </span>
                  </div>
                  {p.mappedChallengeId ? (
                    <StatusBadge tone="success">→ {p.mappedChallengeTitle}</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">{t("unmappedBadge")}</StatusBadge>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {plan.unassignedParticipants.length > 0 && (
          <SectionCard
            title={t("unassignedParticipantsTitle")}
            description={t("unassignedParticipantsDesc")}
          >
            <div className="flex flex-col gap-1.5">
              {plan.unassignedParticipants.map((u) => (
                <div key={u.email} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{memberName(u)}</span>
                  <span className="text-muted-foreground text-xs">{u.email}</span>
                  {u.projectRef && (
                    <span className="text-muted-foreground text-xs">→ {u.projectRef}</span>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        <Modal
          open={detailRepo !== null}
          onOpenChange={(o) => !o && setDetailRepo(null)}
          title={detailRepo?.title ?? t("colProject")}
          description={detailRepo?.url ?? undefined}
          icon={UsersIcon}
          size="lg"
        >
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {detailRepo?.members.length === 0 && (
              <p className="text-muted-foreground text-sm">{t("noTeamMembersPeriod")}</p>
            )}
            {detailRepo?.members.map((m) => (
              <div
                key={m.email}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
              >
                <div className="space-y-0.5">
                  <span className="text-sm font-medium">{memberName(m)}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{m.email}</span>
                  {m.matchedUserName && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      → {m.matchedUserName}
                    </span>
                  )}
                </div>
                <StatusBadge tone={matchTone(m.matchType)}>
                  {matchLabel(m.matchType, t)}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Modal>
      </div>
    );
  }

  // ── phase 1: input ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("importFromDevpost")}
        description={t("devpostImportDesc")}
        actions={
          <Button variant="outline" asChild>
            <Link href="/projects">
              <ArrowLeftIcon className="size-4" />
              {t("projects")}
            </Link>
          </Button>
        }
      />

      <SectionCard
        title={t("devpostExportsTitle")}
        description={t("devpostExportsDesc")}
        icon={FileTextIcon}
        footer={
          <SubmitButton
            type="button"
            pending={previewing}
            disabled={!projectsCsv.trim() || !participantsCsv.trim()}
            onClick={runPreview}
          >
            {t("previewImport")}
          </SubmitButton>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <CsvInput
            label={t("projectsCsvLabel")}
            hint={t("projectsCsvHint")}
            value={projectsCsv}
            onChange={(text) => setProjectsCsv(text)}
            disabled={previewing}
          />
          <CsvInput
            label={t("participantsCsvLabel")}
            hint={t("participantsCsvHint")}
            value={participantsCsv}
            onChange={(text) => setParticipantsCsv(text)}
            disabled={previewing}
          />
        </div>
      </SectionCard>
    </div>
  );
}
