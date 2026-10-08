"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import type { FilterDefinition } from "@/components/common/filter-menu";
import { IconButton } from "@/components/common/icon-button";
import { ListToolbar } from "@/components/common/list-toolbar";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { StatusBadge } from "@/components/common/status-badge";
import { ParticipantDifference } from "@/components/projects/project-submission";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type ProjectSubmission, projectReconciliation } from "@/lib/projects";
import { useCan } from "@/lib/session";
import {
  filterReconciliationRows,
  type ReconciliationRow,
  reconciliationRows,
} from "./reconciliation-list";
import { ReconciliationActions, ReconciliationReview } from "./reconciliation-review";

type Decision = {
  title: string;
  run: (reason: string) => Promise<unknown>;
  project: ProjectSubmission;
};
const SOURCE_LABELS = {
  planning: "projectDraft",
  native: "projectNativeSource",
  devpost: "projectDevpostSource",
  hybrid: "projectHybridSource",
} as const;
export default function ReconciliationPage() {
  const { t } = useLocale();
  const allowed = useCan(CAPABILITIES.PROJECTS_EDIT);
  const canManageRules = useCan(CAPABILITIES.EVENT_MANAGE);
  const [data, setData] = useState<Awaited<ReturnType<typeof projectReconciliation>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("issues");
  const [sources, setSources] = useState<string[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [max, setMax] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const next = await projectReconciliation();
      setData(next);
      setMax(next.config.maxTeamSize?.toString() ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("couldNotLoadProjects"));
    }
  }, [allowed, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const rows = useMemo(() => (data ? reconciliationRows(data) : []), [data]);
  const filtered = useMemo(
    () => filterReconciliationRows(rows, query, scope, sources, issues),
    [rows, query, scope, sources, issues],
  );
  const selected = rows.find((row) => row.key === selectedKey);
  const hasFilters = Boolean(query.trim() || scope !== "all" || sources.length || issues.length);
  function openReview(row: ReconciliationRow) {
    reviewTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedKey(row.key);
  }
  function clearFilters() {
    setQuery("");
    setScope("all");
    setSources([]);
    setIssues([]);
  }
  function choose(project: ProjectSubmission, title: string, run: Decision["run"]) {
    setReason("");
    setError(null);
    setDecision({ project, title, run });
  }
  const filters: FilterDefinition[] = [
    {
      id: "scope",
      label: t("projectReviewScope"),
      icon: FolderSimpleIcon,
      type: "single",
      value: scope,
      resetValue: "all",
      onChange: setScope,
      options: [
        { value: "all", label: t("projectShowAll") },
        { value: "issues", label: t("projectNeedsReview") },
      ],
    },
    {
      id: "source",
      label: t("projectSubmissionSource"),
      icon: FolderSimpleIcon,
      type: "multiple",
      value: sources,
      onChange: setSources,
      options: Object.entries(SOURCE_LABELS).map(([value, key]) => ({ value, label: t(key) })),
    },
    {
      id: "issues",
      label: t("projectReviewIssue"),
      icon: WarningCircleIcon,
      type: "multiple",
      value: issues,
      onChange: setIssues,
      options: (
        [
          "projectEditsRequested",
          "projectParticipantsDiffer",
          "projectUnknownIdentity",
          "projectTeamSizeViolation",
          "projectPossibleTeamSize",
          "projectRejectedClaim",
          "projectNotSubmitted",
          "projectReopened",
        ] as const
      ).map((key) => ({ value: key, label: t(key) })),
    },
  ];
  const columns: Column<ReconciliationRow>[] = [
    {
      id: "project",
      className: "whitespace-normal",
      header: t("projectLabel"),
      sortValue: (row) => row.name.toLocaleLowerCase(),
      cell: (row) => (
        <div className="min-w-0 max-w-64 space-y-1">
          <span className="font-medium wrap-break-word">{row.name}</span>
          <div className="type-meta font-mono">{row.code}</div>
        </div>
      ),
    },
    {
      id: "source",
      className: "whitespace-normal",
      header: t("projectSubmissionSource"),
      sortValue: (row) => row.source,
      cell: (row) => (
        <span className="text-muted-foreground text-sm">{t(SOURCE_LABELS[row.source])}</span>
      ),
    },
    {
      id: "team",
      header: t("teamMembers"),
      align: "right",
      sortValue: (row) => row.project?.participantCount ?? 0,
      cell: (row) => (
        <span className="tabular-nums">
          {row.project
            ? `${row.project.participantCount}${row.project.maxTeamSize ? ` / ${row.project.maxTeamSize}` : ""}`
            : "—"}
        </span>
      ),
    },
    {
      id: "eligibility",
      header: t("projectJudgingEligibility"),
      sortValue: (row) => (row.project?.eligible ? 1 : 0),
      cell: (row) =>
        row.project?.status === "submitted" ? (
          <StatusBadge tone={row.project.eligible ? "success" : "warning"}>
            {t(row.project.eligible ? "projectEligible" : "projectIneligible")}
          </StatusBadge>
        ) : (
          <span className="type-meta">
            {t(row.status === "not_submitted" ? "projectNotSubmitted" : "projectDraft")}
          </span>
        ),
    },
    {
      id: "review",
      className: "whitespace-normal",
      header: t("projectReviewIssue"),
      sortValue: (row) => row.issues.length,
      cell: (row) => (
        <div className="max-w-64 space-y-1 text-sm">
          {row.issues.length ? (
            row.issues.map((issue) => (
              <p key={issue} className="wrap-break-word text-pretty">
                {t(issue)}
              </p>
            ))
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
  ];
  if (!allowed) return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  return (
    <PageLayout>
      <PageHeader
        className="flex-row items-center justify-between gap-2 md:items-center"
        title={t("projectReconciliation")}
        secondaryActions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton variant="outline" label={t("moreActions")}>
                <DotsThreeIcon aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/projects/unmatched">{t("projectResolveIdentities")}</Link>
              </DropdownMenuItem>
              {canManageRules && (
                <DropdownMenuItem
                  onSelect={() => {
                    setError(null);
                    setRulesOpen(true);
                  }}
                >
                  {t("projectSubmissionRules")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="space-y-4">
        <ListToolbar
          search={{
            id: "reconciliation-search",
            label: t("searchProjectsPlaceholder"),
            value: query,
            onValueChange: setQuery,
          }}
          filters={filters}
        />
        <p className="type-meta tabular-nums" role="status" aria-live="polite">
          {t("tableResultCount", { count: filtered.length })}
        </p>
        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(row) => row.key}
          onRowClick={openReview}
          getRowLabel={(row) => row.name}
          pageSize={15}
          loading={!data && !error}
          error={error && !data ? { message: error, onRetry: load } : undefined}
          mutationError={
            error && data && !decision && !rulesOpen ? { message: error, onRetry: load } : undefined
          }
          empty={{ icon: FolderSimpleIcon, title: t("noProjectsYet") }}
          filteredEmpty={{
            active: hasFilters,
            onClear: clearFilters,
            title:
              scope === "issues" && !query && !sources.length && !issues.length
                ? t("projectNoReviewIssues")
                : undefined,
          }}
          renderMobileRow={(row) => (
            <button
              type="button"
              className="button-interaction flex w-full min-w-0 items-center gap-3 p-4 text-left"
              aria-label={row.name}
              onClick={() => openReview(row)}
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="font-medium wrap-break-word">{row.name}</div>
                <div className="type-meta flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono">{row.code}</span>
                  <span>{t(SOURCE_LABELS[row.source])}</span>
                </div>
                {row.issues.length > 0 && (
                  <p className="text-sm wrap-break-word text-pretty">
                    {row.issues.map((issue) => t(issue)).join(" · ")}
                  </p>
                )}
                {row.project && (
                  <StatusBadge tone={row.project.eligible ? "success" : "warning"}>
                    {t(row.project.eligible ? "projectEligible" : "projectIneligible")}
                  </StatusBadge>
                )}
              </div>
              <CaretRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          )}
        />
      </div>
      <Modal
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedKey(null);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (reviewTrigger.current?.isConnected) reviewTrigger.current.focus();
          else document.getElementById("reconciliation-search")?.focus();
        }}
        title={selected?.name ?? t("projectReconciliation")}
        size="lg"
        footer={
          selected?.project && <ReconciliationActions project={selected.project} choose={choose} />
        }
      >
        {selected?.project ? (
          <ReconciliationReview project={selected.project} choose={choose} load={load} />
        ) : (
          selected && (
            <div className="space-y-4">
              <code className="font-mono type-meta">{selected.code}</code>
              <p className="text-sm">
                {t(selected.status === "not_submitted" ? "projectNotSubmitted" : "projectDraft")}
              </p>
            </div>
          )
        )}
      </Modal>
      <SidePanelEditor
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        title={t("projectSubmissionRules")}
        footer={
          <Button
            loading={busy}
            disabled={
              Boolean(max.trim()) &&
              (!Number.isInteger(Number(max)) || Number(max) < 1 || Number(max) > 100)
            }
            onClick={async () => {
              setBusy(true);
              try {
                await api.patch("/api/projects/submission-rules", {
                  maxTeamSize: max.trim() ? Number(max) : null,
                });
                await load();
                setRulesOpen(false);
              } catch (e) {
                setError(e instanceof ApiError ? e.message : t("couldNotSaveProject"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("save")}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="max-team-size" className="type-label">
              {t("projectMaxTeamSize")}
            </label>
            <Input
              id="max-team-size"
              type="number"
              min={1}
              max={100}
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </div>
          {error && <ContextualError message={error} />}
        </div>
      </SidePanelEditor>
      <AlertModal
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        title={decision?.title ?? t("projectReconciliation")}
        description={t(
          decision?.title === t("projectUnlink") ? "projectUnlinkImpact" : "projectResolveImpact",
        )}
        confirmLabel={decision?.title ?? t("save")}
        cancelLabel={t("cancel")}
        pending={busy}
        confirmDisabled={!reason.trim()}
        onConfirm={async () => {
          if (!decision) return;
          setBusy(true);
          try {
            await decision.run(reason.trim());
            await load();
            setDecision(null);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : t("couldNotSaveProject"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-4">
          <p className="font-medium">{decision?.project.name}</p>
          {decision?.project.membershipDiffers && (
            <ParticipantDifference state={decision.project} />
          )}
          <div className="space-y-2">
            <label htmlFor="decision-reason" className="type-label">
              {t("projectReason")}
            </label>
            <Textarea
              id="decision-reason"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <ContextualError message={error} />}
        </div>
      </AlertModal>
    </PageLayout>
  );
}
