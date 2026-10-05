"use client";

// Submitted responses (H13/H14): filtering, review, scoring and decisions.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ChecksIcon } from "@phosphor-icons/react/dist/csr/Checks";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApplicationExportPanel } from "@/components/applications/application-export-panel";
import { ReviewModal } from "@/components/applications/review-modal";
import { ActionGroup } from "@/components/common/action-group";
import { AlertModal } from "@/components/common/alert-modal";
import { type Column, DataTable } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { pickText, useLocale } from "@/lib/i18n";
import { useCan, useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
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
  const isMobile = useIsMobile();
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
  const hasLoadedRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [decisionStatusOverrides, setDecisionStatusOverrides] = useState<Record<number, string>>(
    {},
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<DurableBatchResult | null>(null);
  const [confirmBatchRevoke, setConfirmBatchRevoke] = useState(false);
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [exportFailures, setExportFailures] = useState<ExportFailuresState | null>(null);
  // The table's own search/sort-applied row order, for modal prev/next.
  const [visibleRows, setVisibleRows] = useState<ResponseRow[]>([]);

  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rowsForWorkspace(allRows, workspace).filter(
      (row) =>
        (statusFilter.length === 0 || statusFilter.includes(row.status)) &&
        (!query || `${row.name ?? ""} ${row.email}`.toLocaleLowerCase().includes(query)),
    );
  }, [allRows, workspace, statusFilter, search]);

  const load = useCallback(
    async (force = false) => {
      // Keep the current table snapshot stable while a response modal is open.
      // In particular, accepting a review moves it out of this workspace; the
      // reviewer should still be able to navigate the familiar set and use undo.
      if (!force && selectedId !== null) return;
      if (!hasLoadedRef.current) setLoading(true);
      setLoadError(null);
      try {
        const { responses } = await api.get<{ responses: ResponseRow[] }>(
          `/api/applications/${id}/responses`,
        );
        setAllRows(responses);
        setDecisionStatusOverrides({});
        setSelectedIds(new Set());
        hasLoadedRef.current = true;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : t("couldNotLoadResponses");
        setLoadError(message);
        toast.error(message, t("workspaceApplications"));
      } finally {
        setLoading(false);
      }
    },
    [id, selectedId, t],
  );

  // Soft, in-place refresh instead of a hard reload when a response changes
  // (submitted, reviewed, decided) elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=applications", [
    EVENTS.DOMAIN_CHANGED,
  ]);

  // Coalesce live refreshes; categorical filters and search share the loaded snapshot.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    const handle = setTimeout(() => void load(true), 250);
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

  const selected = useMemo(() => {
    const row = rows.find((r) => r.id === selectedId);
    if (!row) return null;
    const status = decisionStatusOverrides[row.id];
    return status && status !== row.status ? { ...row, status } : row;
  }, [decisionStatusOverrides, rows, selectedId]);
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
            <CheckCircleIcon className="text-success size-3.5" aria-label={t("reviewedByYou")} />
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

  function fileLabel(field: TemplateField) {
    const label = pickText(field.label, language).trim();
    return label && label !== field.key && !/^field_\d+$/.test(label)
      ? label
      : t("exportMenuAttachment", { number: fileFields.indexOf(field) + 1 });
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
          fieldLabel: fileLabel(field),
          total: parsed.total,
          items: parsed.items,
        });
        toast.error(t("exportFilesFailedToast", { count: parsed.total }), t("exportFiles"));
      } else {
        toast.success(t("exportFilesDownloaded"), { compactTitle: t("exportFiles") });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("exportFailed"), t("exportFiles"));
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
      if (skipped.length === 0) toast.success(label, { compactTitle: t("toastDecisions") });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("batchActionFailed"),
        t("toastDecisions"),
      );
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
      <ListToolbar
        search={{
          id: "response-search",
          label: t("searchResponses"),
          placeholder: t("searchByNameOrEmailPlaceholder"),
          value: search,
          onValueChange: (value) => {
            setSearch(value);
            setSelectedIds(new Set());
          },
        }}
        filters={[
          {
            id: "status",
            label: t("statusColumn"),
            icon: ChecksIcon,
            type: "multiple",
            value: statusFilter,
            onChange: (value) => {
              setStatusFilter(value);
              setSelectedIds(new Set());
            },
            options: statusesForWorkspace(workspace).map((status) => ({
              value: status,
              label: applicationStatusLabel(status, t),
            })),
          },
        ]}
        actions={
          (canExportFiles || (canDecide && workspace === "outbox")) && (
            <ActionGroup className="justify-end">
              {canExportFiles && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size={isMobile ? "icon" : "default"}
                      aria-label={t("export")}
                      ref={exportTriggerRef}
                    >
                      <DownloadSimpleIcon aria-hidden="true" />
                      {!isMobile && t("export")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="max-w-[calc(100vw-2rem)] [&_[data-slot=dropdown-menu-item]]:whitespace-normal"
                  >
                    <DropdownMenuLabel>{t("exportMenuDataGroup")}</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => setExportOpen(true)}>
                      <DownloadSimpleIcon aria-hidden="true" />
                      {t("exportMenuApplicationData")}
                    </DropdownMenuItem>
                    {fileFields.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>{t("exportMenuFilesGroup")}</DropdownMenuLabel>
                      </>
                    )}
                    {fileFields.map((field, index) => (
                      <div key={field.key}>
                        {index > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem
                          disabled={exportingKey === `${field.key}:all`}
                          onClick={() => void exportField(field, "all")}
                        >
                          {t("exportMenuDownloadAttachment", { field: fileLabel(field) })}
                        </DropdownMenuItem>
                        {field.shareable_with_sponsors && (
                          <DropdownMenuItem
                            disabled={exportingKey === `${field.key}:shared`}
                            onClick={() => void exportField(field, "shared")}
                          >
                            {t("exportMenuDownloadSharedAttachment", { field: fileLabel(field) })}
                          </DropdownMenuItem>
                        )}
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {canDecide && workspace === "outbox" && (
                <Button
                  size={isMobile ? "icon" : "default"}
                  aria-label={t("sendDecisions")}
                  onClick={() => setSendOpen(true)}
                >
                  <PaperPlaneTiltIcon aria-hidden="true" />
                  {!isMobile && t("sendDecisions")}
                </Button>
              )}
            </ActionGroup>
          )
        }
      />
      <span role="status" aria-live="polite" className="text-muted-foreground text-xs tabular-nums">
        {t("tableResultCount", { count: rows.length })}
      </span>

      {canDecide && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <span className="text-sm font-medium">
            {t("selectedCount", { count: selectedIds.size })}
          </span>
          <ActionGroup className="ml-auto justify-end">
            {/* Primary action per workspace (decide / send / resend). Everything
                else lives under "More" to keep the bar uncluttered. */}
            {workspace === "review" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={batchBusy}>
                    <ChecksIcon aria-hidden="true" />
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
                loading={batchBusy}
              >
                <PaperPlaneTiltIcon aria-hidden="true" />
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
                loading={batchBusy}
              >
                <PaperPlaneTiltIcon aria-hidden="true" />
                {t("resend")}
              </Button>
            )}
            {workspace === "outbox" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size={isMobile ? "icon-sm" : "sm"}
                    variant="outline"
                    disabled={batchBusy}
                    aria-label={t("more")}
                  >
                    <DotsThreeIcon aria-hidden="true" />
                    {!isMobile && t("more")}
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
                  <Button
                    size={isMobile ? "icon-sm" : "sm"}
                    variant="outline"
                    disabled={batchBusy}
                    aria-label={t("more")}
                  >
                    <DotsThreeIcon aria-hidden="true" />
                    {!isMobile && t("more")}
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
                        api.post(
                          "/api/responses/batch/re-accept",
                          {
                            response_ids: selectedArr.map((r) => r.id),
                          },
                          {
                            headers: { "Idempotency-Key": crypto.randomUUID() },
                          },
                        ),
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
              size={isMobile ? "icon-sm" : "sm"}
              variant="ghost"
              aria-label={t("clear")}
              disabled={batchBusy}
              onClick={() => setSelectedIds(new Set())}
            >
              <XIcon aria-hidden="true" />
              {!isMobile && t("clear")}
            </Button>
          </ActionGroup>
        </div>
      )}

      {exportFailures && (
        <Alert variant="destructive">
          <WarningCircleIcon aria-hidden="true" />
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
          <WarningCircleIcon aria-hidden="true" />
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

      {canExportFiles && (
        <ApplicationExportPanel
          applicationId={id}
          open={exportOpen}
          onOpenChange={setExportOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            exportTriggerRef.current?.focus();
          }}
          trigger={false}
        />
      )}
      <DataTable
        renderMobileRow={(row) => (
          <div className="flex items-start gap-3 p-4">
            {canDecide && (
              <Checkbox
                className="mt-1"
                aria-label={`${t("selectRow")}: ${row.name ?? row.email}`}
                checked={selectedIds.has(String(row.id))}
                onCheckedChange={(checked) =>
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (checked) next.add(String(row.id));
                    else next.delete(String(row.id));
                    return next;
                  })
                }
              />
            )}
            <div className="min-w-0 flex-1 space-y-3">
              <button
                type="button"
                onClick={() => setSelectedId(row.id)}
                className="focus-visible:ring-ring flex min-h-11 w-full items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block wrap-break-word font-medium">{row.name ?? row.email}</span>
                  <span className="text-muted-foreground block wrap-break-word text-xs">
                    {row.email}
                  </span>
                </span>
                <CaretRightIcon
                  className="mt-1 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
              <StatusBadge tone={statusTone(row.status)}>
                {applicationStatusLabel(row.status, t)}
              </StatusBadge>
              <dl className="grid gap-2 text-xs">
                {columns
                  .filter((column) => {
                    if (column.id === "applicant" || column.id === "status") return false;
                    if (column.id === "score") return row.avg_score != null || row.review_count > 0;
                    if (column.id === "submitted") return Boolean(row.submitted_at);
                    if (column.id === "communicated") return Boolean(row.decision_sent_at);
                    if (column.id === "deadline") return Boolean(row.confirmation_expires_at);
                    return true;
                  })
                  .map((column) => (
                    <div
                      key={column.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
                    >
                      <dt className="text-muted-foreground">{column.header}</dt>
                      <dd>{column.cell(row)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          </div>
        )}
        columns={columns}
        data={rows}
        getRowId={(r) => String(r.id)}
        loading={loading && !hasLoadedRef.current}
        error={
          !hasLoadedRef.current && loadError ? { message: loadError, onRetry: load } : undefined
        }
        mutationError={
          hasLoadedRef.current && loadError ? { message: loadError, onRetry: load } : undefined
        }
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
            statusFilter.length === 0 && !search.trim()
              ? t("submissionsAppearHereDesc")
              : t("noResponsesMatchFilterDesc"),
        }}
        filteredEmpty={{
          active: statusFilter.length > 0 || search.trim().length > 0,
          onClear: () => {
            setStatusFilter([]);
            setSearch("");
            setSelectedIds(new Set());
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
          onClose={() => {
            setSelectedId(null);
            setDecisionStatusOverrides({});
            void load(true);
          }}
          onChanged={() => load(true)}
          workspace={workspace}
          onDecisionStatusChange={(status) => {
            setDecisionStatusOverrides((current) => ({
              ...current,
              [selected.id]: status,
            }));
          }}
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
