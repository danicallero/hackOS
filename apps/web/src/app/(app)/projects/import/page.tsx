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
import { useCallback, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function readFile(file: File) {
    try {
      const text = await file.text();
      setFileName(file.name);
      onChange(text, file.name);
    } catch {
      toast.error(`Could not read ${file.name}.`);
    }
  }

  const lineCount = value ? value.trim().split(/\r?\n/).length : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {value ? (
          <StatusBadge tone="success">
            {fileName ?? "Pasted"} · {Math.max(0, lineCount - 1)} rows
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
          Choose CSV
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
            Clear
          </Button>
        )}
      </div>
      <Textarea
        value={value}
        disabled={disabled}
        placeholder="…or paste the raw CSV text here"
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

const repoColumns: Column<PlanRepo>[] = [
  {
    id: "title",
    header: "Project",
    sortValue: (r) => r.title.toLowerCase(),
    cell: (r) => <span className="font-medium">{r.title}</span>,
  },
  {
    id: "action",
    header: "Action",
    align: "center",
    sortValue: (r) => r.action,
    cell: (r) => (
      <StatusBadge tone={r.action === "create" ? "success" : "info"}>
        {r.action === "create" ? "Create" : "Update"}
      </StatusBadge>
    ),
  },
  {
    id: "team",
    header: "Team",
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
    header: "Members",
    align: "center",
    sortValue: (r) => repoUnmatched(r),
    cell: (r) => {
      const unmatched = repoUnmatched(r);
      if (r.members.length === 0) return <span className="text-muted-foreground text-sm">—</span>;
      return unmatched === 0 ? (
        <StatusBadge tone="success">All matched</StatusBadge>
      ) : (
        <StatusBadge tone="warning">{unmatched} unmatched</StatusBadge>
      );
    },
  },
  {
    id: "prizes",
    header: "Prizes",
    sortValue: (r) => r.prizes.length,
    cell: (r) =>
      r.prizes.length === 0 ? (
        <span className="text-muted-foreground text-sm">—</span>
      ) : (
        <span className="text-muted-foreground text-sm">{r.prizes.length}</span>
      ),
  },
];

export default function ImportProjectsPage() {
  const { can } = useSessionContext();
  const canImport = can(CAPABILITIES.PROJECTS_IMPORT);

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
      toast.error("Provide both the projects and participants CSV exports.");
      return;
    }
    setPreviewing(true);
    try {
      const p = await previewImport(projectsCsv, participantsCsv);
      setPlan(toImportPlanView(p));
      idemKey.current = crypto.randomUUID();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not preview the import.");
    } finally {
      setPreviewing(false);
    }
  }, [projectsCsv, participantsCsv]);

  const runConfirm = useCallback(async () => {
    if (!plan) return;
    if (!idemKey.current) idemKey.current = crypto.randomUUID();
    setConfirming(true);
    try {
      const res = await confirmImport(projectsCsv, participantsCsv, idemKey.current);
      setResult(res as unknown as ConfirmResult);
      toast.success("Import applied.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not apply the import.");
    } finally {
      setConfirming(false);
    }
  }, [plan, projectsCsv, participantsCsv]);

  function reset() {
    setPlan(null);
    setResult(null);
    idemKey.current = null;
  }

  if (!canImport) {
    return (
      <div className="space-y-6">
        <PageHeader title="Import from Devpost" />
        <EmptyState
          icon={LockIcon}
          title="You can't import projects"
          description="Importing requires the projects:import capability."
        />
      </div>
    );
  }

  // ── phase 3: confirmed ─────────────────────────────────────────────────────
  if (result) {
    const c = result.counts;
    return (
      <div className="space-y-6">
        <PageHeader title="Import complete" description={`Batch ${result.batchId}`} />
        <SectionCard
          title="Import applied"
          description="Devpost submissions were written into hackOS."
          icon={CheckCircle2Icon}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Projects created" value={c.reposCreated} />
            <StatCard label="Projects updated" value={c.reposUpdated} />
            <StatCard label="Members matched" value={c.participantsMatched} />
            <StatCard label="Members unmatched" value={c.participantsUnmatched} />
            <StatCard label="Prizes seen" value={c.prizesSeen} />
          </div>
          {c.participantsUnmatched > 0 && (
            <p className="text-muted-foreground text-sm">
              {c.participantsUnmatched} participant{c.participantsUnmatched > 1 ? "s" : ""} didn’t
              match an account. Resolve them on the unmatched page.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/projects">View projects</Link>
            </Button>
            {c.participantsUnmatched > 0 && (
              <Button asChild variant="outline">
                <Link href="/projects/unmatched">Resolve unmatched</Link>
              </Button>
            )}
            <Button variant="ghost" onClick={reset}>
              Import another
            </Button>
          </div>
        </SectionCard>
      </div>
    );
  }

  // ── phase 2: review plan ───────────────────────────────────────────────────
  if (plan) {
    const t = plan.totals;
    return (
      <div className="space-y-6">
        <PageHeader
          title="Review import"
          description="Nothing has been written yet. Confirm to apply this plan."
          actions={
            <>
              <Button variant="outline" onClick={reset} disabled={confirming}>
                <ArrowLeftIcon className="size-4" />
                Back
              </Button>
              <SubmitButton type="button" pending={confirming} onClick={runConfirm}>
                Confirm import
              </SubmitButton>
            </>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Projects"
            value={t.repos}
            hint={`${t.reposToCreate} new · ${t.reposToUpdate} update`}
          />
          <StatCard
            label="Members"
            value={t.members}
            hint={`${t.membersMatched} matched · ${t.membersUnmatched} unmatched`}
          />
          <StatCard label="Prizes" value={t.prizes} />
          <StatCard label="Unassigned rows" value={plan.unassignedParticipants.length} />
        </div>

        <DataTable
          columns={repoColumns}
          data={plan.repos}
          getRowId={(r) => `${r.title}::${r.url ?? ""}`}
          onRowClick={(r) => setDetailRepo(r)}
          searchable={(r) => `${r.title} ${r.prizes.join(" ")}`}
          searchPlaceholder="Search projects…"
          pageSize={15}
          empty={{ icon: FileTextIcon, title: "No projects parsed" }}
        />

        {plan.prizes.length > 0 && (
          <SectionCard
            title="Prizes"
            description="Devpost opt-in prizes and whether they already map to a challenge."
          >
            <div className="flex flex-col gap-2">
              {plan.prizes.map((p) => (
                <div
                  key={p.name}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {p.repoCount} project{p.repoCount > 1 ? "s" : ""}
                    </span>
                  </div>
                  {p.mappedChallengeId ? (
                    <StatusBadge tone="success">→ {p.mappedChallengeTitle}</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Unmapped</StatusBadge>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {plan.unassignedParticipants.length > 0 && (
          <SectionCard
            title="Unassigned participants"
            description="Rows in the participants export whose project reference matched no project row — they won’t be imported."
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
          title={detailRepo?.title ?? "Project"}
          description={detailRepo?.url ?? undefined}
          icon={UsersIcon}
          size="lg"
        >
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {detailRepo?.members.length === 0 && (
              <p className="text-muted-foreground text-sm">No team members.</p>
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
                <StatusBadge tone={matchTone(m.matchType)}>{matchLabel(m.matchType)}</StatusBadge>
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
        title="Import from Devpost"
        description="Upload or paste the two Devpost CSV exports. Preview is read-only — nothing is written until you confirm."
        actions={
          <Button variant="outline" asChild>
            <Link href="/projects">
              <ArrowLeftIcon className="size-4" />
              Projects
            </Link>
          </Button>
        }
      />

      <SectionCard
        title="Devpost exports"
        description="The projects (submissions) export and the participants (registrants) export."
        icon={FileTextIcon}
        footer={
          <SubmitButton
            type="button"
            pending={previewing}
            disabled={!projectsCsv.trim() || !participantsCsv.trim()}
            onClick={runPreview}
          >
            Preview import
          </SubmitButton>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <CsvInput
            label="Projects CSV"
            hint="Devpost “projects/submissions” export — columns like Project Title, Submission Url, Opt-In Prizes, Team Member N Email."
            value={projectsCsv}
            onChange={(text) => setProjectsCsv(text)}
            disabled={previewing}
          />
          <CsvInput
            label="Participants CSV"
            hint="Devpost “participants/registrants” export — columns like Email, First Name, Last Name, Project URLs."
            value={participantsCsv}
            onChange={(text) => setParticipantsCsv(text)}
            disabled={previewing}
          />
        </div>
      </SectionCard>
    </div>
  );
}
