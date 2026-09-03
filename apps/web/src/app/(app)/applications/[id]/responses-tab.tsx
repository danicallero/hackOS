"use client";

// Submitted responses (H13/H14): filtering, review, scoring and decisions.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  AlertCircleIcon,
  CheckCheckIcon,
  CircleCheckIcon,
  DownloadIcon,
  FileTextIcon,
  RotateCcwIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ReviewModal } from "@/components/applications/review-modal";
import { AlertModal } from "@/components/common/alert-modal";
import { type Column, DataTable } from "@/components/common/data-table";
import { IconButton } from "@/components/common/icon-button";
import { StatusBadge } from "@/components/common/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { pickText, useLocale } from "@/lib/i18n";
import { useCan, useMe } from "@/lib/session";
import {
  type FormSection,
  fmtDateTime,
  fmtScore,
  type ResponseRow,
  statusTone,
  type TemplateField,
} from "../lib";
import {
  type ApplicationWorkspace,
  applicationStatusLabel,
  rowsForWorkspace,
  statusesForWorkspace,
} from "../workflow";
import { SendDecisionsModal } from "./send-decisions-modal";

const ALL = "__all__";

interface DurableBatchResult {
  label: string;
  processed: number;
  skipped: Array<{ id: number; reason: string; applicant: string }>;
}

interface ExportFileFailure {
  responseId: number;
  userId: number;
  email: string;
}

interface ExportFailuresState {
  fieldKey: string;
  fieldLabel: string;
  total: number;
  items: ExportFileFailure[];
}

export function ResponsesTab({
  id,
  template,
  sections,
  askShirtSize,
  askFoodIntolerances,
  workspace,
}: {
  id: number;
  template: TemplateField[] | null;
  sections: FormSection[];
  askShirtSize: boolean;
  askFoodIntolerances: boolean;
  workspace: ApplicationWorkspace;
}) {
  const { t, language } = useLocale();
  const me = useMe();
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const canExportFiles = useCan(CAPABILITIES.EXPORTS_RUN);
  const fileFields = useMemo(() => (template ?? []).filter((f) => f.kind === "file"), [template]);
  const exportUrl = useCallback(
    (fieldKey: string, scope: "all" | "shared") =>
      `${API_URL}/api/applications/${id}/fields/${encodeURIComponent(fieldKey)}/files.zip?scope=${scope}`,
    [id],
  );
  const [allRows, setAllRows] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<DurableBatchResult | null>(null);
  const [confirmBatchRevoke, setConfirmBatchRevoke] = useState(false);
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [exportFailures, setExportFailures] = useState<ExportFailuresState | null>(null);
  // The table's own search/sort-applied row order, for modal prev/next.
  const [visibleRows, setVisibleRows] = useState<ResponseRow[]>([]);

  const rows = useMemo(() => rowsForWorkspace(allRows, workspace), [allRows, workspace]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { responses } = await api.get<{ responses: ResponseRow[] }>(
        `/api/applications/${id}/responses`,
        {
          query: {
            status: statusFilter === ALL ? undefined : statusFilter,
            search: search.trim() || undefined,
          },
        },
      );
      setAllRows(responses);
      setSelectedIds(new Set());
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadResponses");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [id, statusFilter, search, t]);

  // Soft, in-place refresh instead of a hard reload when a response changes
  // (submitted, reviewed, decided) elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=applications", [
    EVENTS.DOMAIN_CHANGED,
  ]);

  // Debounce so server-side search/filter doesn't fire on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load, liveRefresh]);

  // Deep-link: `?response=<id>` (used by the profile Application tab) opens that
  // specific response's review modal directly — the same view as clicking a row
  // — instead of leaving the staff on the general responses list.
  const [pendingResponseId, setPendingResponseId] = useState<number | null>(() => {
    const p = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get(
      "response",
    );
    return p && /^\d+$/.test(p) ? Number(p) : null;
  });
  useEffect(() => {
    if (pendingResponseId != null && rows.some((r) => r.id === pendingResponseId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- wait for rows to load, then select the pending id from URL deep-link
      setSelectedId(pendingResponseId);
      setPendingResponseId(null);
    }
  }, [rows, pendingResponseId]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const selectedIndex = useMemo(
    () => visibleRows.findIndex((r) => r.id === selectedId),
    [visibleRows, selectedId],
  );

  const columns: Column<ResponseRow>[] = [
    {
      id: "applicant",
      header: t("applicantColumn"),
      sortValue: (r) => (r.name ?? r.email).toLowerCase(),
      cell: (r) => (
        <div className="space-y-0.5">
          <div className="font-medium">{r.name ?? "—"}</div>
          <div className="text-muted-foreground text-xs">{r.email}</div>
        </div>
      ),
    },
    {
      id: "status",
      header: t("statusColumn"),
      sortValue: (r) => r.status,
      cell: (r) => (
        <StatusBadge tone={statusTone(r.status)}>{applicationStatusLabel(r.status, t)}</StatusBadge>
      ),
    },
    {
      id: "score",
      header: t("scoreColumn"),
      align: "right",
      sortValue: (r) => Number(r.avg_score ?? -1),
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {r.reviews.some((review) => review.author_id === me?.id && review.score != null) && (
            <CircleCheckIcon className="text-success size-3.5" aria-label={t("reviewedByYou")} />
          )}
          {fmtScore(r.avg_score)}
          {r.review_count > 0 && (
            <span className="text-muted-foreground text-xs"> · {r.review_count}</span>
          )}
        </span>
      ),
    },
    {
      id: "submitted",
      header: t("dataStatusSubmitted"),
      align: "right",
      sortValue: (r) => r.submitted_at ?? "",
      cell: (r) => (
        <span className="text-muted-foreground text-sm">{fmtDateTime(r.submitted_at)}</span>
      ),
    },
  ];

  if (workspace === "sent") {
    columns.push({
      id: "communicated",
      header: t("decisionDeliveryColumn"),
      align: "right",
      sortValue: (r) => r.decision_sent_at ?? "",
      cell: (r) => (
        <span className="text-muted-foreground text-sm tabular-nums">
          {r.decision_sent_at ? fmtDateTime(r.decision_sent_at) : t("notSentYet")}
        </span>
      ),
    });
    columns.push({
      id: "deadline",
      header: t("confirmationDeadlineColumn"),
      align: "right",
      sortValue: (r) => r.confirmation_expires_at ?? "",
      cell: (r) => (
        <span className="text-muted-foreground text-sm tabular-nums">
          {r.confirmation_expires_at ? fmtDateTime(r.confirmation_expires_at) : "—"}
        </span>
      ),
    });
  }

  // Downloads via fetch (not a plain <a href>) so we can read the
  // x-export-file-failures response header and surface it in the UI —
  // browsers give JS no way to inspect headers of a navigation-triggered
  // download (H56 follow-up: report + let staff manually handle failures).
  async function exportField(field: TemplateField, scope: "all" | "shared") {
    const busyKey = `${field.key}:${scope}`;
    setExportingKey(busyKey);
    try {
      const res = await fetch(exportUrl(field.key, scope), { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? t("exportFailed"));
      }
      const failuresHeader = res.headers.get("x-export-file-failures");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${field.key}-${scope}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);

      if (failuresHeader) {
        const parsed = JSON.parse(failuresHeader) as {
          total: number;
          items: ExportFileFailure[];
        };
        setExportFailures({
          fieldKey: field.key,
          fieldLabel: pickText(field.label, language) || field.key,
          total: parsed.total,
          items: parsed.items,
        });
        toast.error(t("exportFilesFailedToast", { count: parsed.total }));
      } else {
        toast.success(t("exportFilesDownloaded"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("exportFailed"));
    } finally {
      setExportingKey(null);
    }
  }

  async function batchAction(label: string, fn: () => Promise<unknown>) {
    setBatchBusy(true);
    try {
      const result = (await fn()) as
        | { processed?: number; sent?: number; skipped?: { id: number; reason: string }[] }
        | undefined;
      const skipped = (result?.skipped ?? []).map((item) => ({
        ...item,
        applicant:
          allRows.find((row) => row.id === item.id)?.name ??
          allRows.find((row) => row.id === item.id)?.email ??
          `#${item.id}`,
      }));
      setBatchResult({
        label,
        processed:
          result?.processed ?? result?.sent ?? Math.max(0, selectedIds.size - skipped.length),
        skipped,
      });
      await load();
      if (skipped.length === 0) toast.success(label);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("batchActionFailed"));
    } finally {
      setBatchBusy(false);
    }
  }

  const selectedArr = useMemo(
    () => rows.filter((r) => selectedIds.has(String(r.id))),
    [rows, selectedIds],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <label htmlFor="response-search" className="sr-only">
            {t("searchResponses")}
          </label>
          <Input
            id="response-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchByNameOrEmailPlaceholder")}
            className="pr-9"
          />
          {search && (
            <IconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-1/2 right-0.5 -translate-y-1/2"
              onClick={() => {
                setSearch("");
                document.getElementById("response-search")?.focus();
              }}
              label={t("clearSearch")}
            >
              <XIcon aria-hidden="true" />
            </IconButton>
          )}
        </div>
        <span
          role="status"
          aria-live="polite"
          className="text-muted-foreground text-xs tabular-nums"
        >
          {t("tableResultCount", { count: rows.length })}
        </span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 capitalize">
            <SelectValue placeholder={t("allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
            {statusesForWorkspace(workspace).map((s) => (
              <SelectItem key={s} value={s}>
                {applicationStatusLabel(s, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          {canExportFiles && fileFields.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <DownloadIcon />
                  {t("exportFiles")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {fileFields.map((field, index) => (
                  <div key={field.key}>
                    {index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>
                      {pickText(field.label, language) || field.key}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={exportingKey === `${field.key}:all`}
                      onClick={() => void exportField(field, "all")}
                    >
                      {t("exportAllFiles")}
                    </DropdownMenuItem>
                    {field.shareable_with_sponsors && (
                      <DropdownMenuItem
                        disabled={exportingKey === `${field.key}:shared`}
                        onClick={() => void exportField(field, "shared")}
                      >
                        {t("exportSharedFiles")}
                      </DropdownMenuItem>
                    )}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canDecide && workspace === "outbox" && (
            <Button variant="outline" onClick={() => setSendOpen(true)}>
              <SendIcon />
              {t("sendDecisions")}
            </Button>
          )}
        </div>
      </div>

      {canDecide && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border p-3">
          <span className="text-sm font-medium">
            {t("selectedCount", { count: selectedIds.size })}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {/* Primary action per workspace (decide / send / resend). Everything
                else lives under "More" to keep the bar uncluttered. */}
            {workspace === "review" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={batchBusy}>
                    <CheckCheckIcon />
                    {t("decide")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("decisionsApplied"), () =>
                        api.post("/api/responses/batch/decide", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "accepted",
                        }),
                      )
                    }
                  >
                    {t("accept")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("decisionsApplied"), () =>
                        api.post("/api/responses/batch/decide", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    {t("reject")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {workspace === "outbox" && (
              <Button
                size="sm"
                variant="outline"
                disabled={batchBusy}
                onClick={() =>
                  batchAction(t("decisionsSent"), () =>
                    api.post("/api/responses/batch/send-decision", {
                      response_ids: selectedArr.map((r) => r.id),
                    }),
                  )
                }
              >
                <SendIcon />
                {t("send")}
              </Button>
            )}
            {workspace === "sent" && (
              <Button
                size="sm"
                variant="outline"
                disabled={batchBusy}
                onClick={() =>
                  batchAction(t("decisionsResent"), () =>
                    api.post("/api/responses/batch/resend-decision", {
                      response_ids: selectedArr.map((r) => r.id),
                    }),
                  )
                }
              >
                <SendIcon />
                {t("resend")}
              </Button>
            )}
            {workspace === "outbox" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={batchBusy}>
                    <RotateCcwIcon />
                    {t("more")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("revert")}</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("revertedToAcceptedInternal"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "accepted",
                        }),
                      )
                    }
                  >
                    {t("toAcceptedUnsend")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("revertedToRejectedInternal"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    {t("toRejectedUnsend")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("movedBackToReview"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "review",
                        }),
                      )
                    }
                  >
                    {t("backToReview")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {workspace === "sent" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={batchBusy}>
                    <RotateCcwIcon />
                    {t("more")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("revert")}</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("revertedToAcceptedInternal"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "accepted",
                        }),
                      )
                    }
                  >
                    {t("toAcceptedUnsend")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("revertedToRejectedInternal"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    {t("toRejectedUnsend")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("movedBackToReview"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "review",
                        }),
                      )
                    }
                  >
                    {t("backToReview")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("reaccepted"), () =>
                        api.post("/api/responses/batch/re-accept", {
                          response_ids: selectedArr.map((r) => r.id),
                        }),
                      )
                    }
                  >
                    {t("reacceptDeclinedExpired")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmBatchRevoke(true)}
                  >
                    {t("revokeSpot")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={batchBusy}
              onClick={() => setSelectedIds(new Set())}
            >
              <XIcon />
              {t("clear")}
            </Button>
          </div>
        </div>
      )}

      {exportFailures && (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t("exportFailuresTitle", { field: exportFailures.fieldLabel })}</AlertTitle>
          <AlertDescription>
            <p>{t("exportFailuresDesc", { count: exportFailures.total })}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {exportFailures.items.map((item) => (
                <li key={item.responseId} className="flex flex-wrap items-center gap-2">
                  <span>{item.email}</span>
                  <Link
                    href={`/users/${item.userId}?tab=application`}
                    className="text-primary text-xs underline underline-offset-4"
                  >
                    {t("viewProfile")}
                  </Link>
                </li>
              ))}
            </ul>
            {exportFailures.total > exportFailures.items.length && (
              <p className="text-muted-foreground mt-2 text-xs">
                {t("exportFailuresMoreNotShown", {
                  count: exportFailures.total - exportFailures.items.length,
                })}
              </p>
            )}
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => setExportFailures(null)}
            >
              {t("dismissResult")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {batchResult && (
        <Alert variant={batchResult.skipped.length > 0 ? "destructive" : "default"}>
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>
            {t("batchResultTitle")}: {batchResult.label}
          </AlertTitle>
          <AlertDescription>
            <p>{t("batchProcessed", { count: batchResult.processed })}</p>
            {batchResult.skipped.length > 0 && (
              <div className="mt-2">
                <p className="font-medium">
                  {t("batchSkippedTitle", { count: batchResult.skipped.length })}
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {batchResult.skipped.map((item) => (
                    <li key={item.id}>
                      {item.applicant}: {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => setBatchResult(null)}
            >
              {t("dismissResult")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <AlertModal
        open={confirmBatchRevoke}
        onOpenChange={setConfirmBatchRevoke}
        title={t("revokeSpot")}
        description={t("revokeSpotWarning")}
        cancelLabel={t("cancel")}
        confirmLabel={t("revokeSpot")}
        destructive
        pending={batchBusy}
        onConfirm={() => {
          void batchAction(t("spotsRevoked"), () =>
            api.post("/api/responses/batch/revoke-spot", {
              response_ids: selectedArr.map((r) => r.id),
            }),
          ).finally(() => setConfirmBatchRevoke(false));
        }}
      />

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        onRowClick={(r) => setSelectedId(r.id)}
        getRowLabel={(r) => r.name ?? r.email}
        selectable={canDecide}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onVisibleRowsChange={setVisibleRows}
        pageSize={15}
        empty={{
          icon: FileTextIcon,
          title: t("noResponsesTitle"),
          description:
            statusFilter === ALL && !search.trim()
              ? t("submissionsAppearHereDesc")
              : t("noResponsesMatchFilterDesc"),
        }}
        filteredEmpty={{
          active: statusFilter !== ALL || search.trim().length > 0,
          onClear: () => {
            setStatusFilter(ALL);
            setSearch("");
            document.getElementById("response-search")?.focus();
          },
        }}
      />

      {selected && (
        <ReviewModal
          response={selected}
          applicationId={id}
          template={template}
          sections={sections}
          askShirtSize={askShirtSize}
          askFoodIntolerances={askFoodIntolerances}
          onClose={() => setSelectedId(null)}
          onChanged={load}
          workspace={workspace}
          onNavigate={(dir) => {
            if (selectedIndex < 0) return;
            const next = visibleRows[selectedIndex + (dir === "next" ? 1 : -1)];
            if (next) setSelectedId(next.id);
          }}
          canGoPrev={selectedIndex > 0}
          canGoNext={selectedIndex >= 0 && selectedIndex < visibleRows.length - 1}
        />
      )}

      {canDecide && (
        <SendDecisionsModal id={id} open={sendOpen} onOpenChange={setSendOpen} onSent={load} />
      )}
    </div>
  );
}
