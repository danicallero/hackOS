"use client";

// Submitted responses (H13/H14): filtering, review, scoring and decisions.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ChecksIcon } from "@phosphor-icons/react/dist/csr/Checks";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ApplicationExportPanel } from "@/components/applications/application-export-panel";
import { ReviewModal } from "@/components/applications/review-modal";
import { ActionGroup } from "@/components/common/action-group";
import { AlertModal } from "@/components/common/alert-modal";
import { DataTable } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
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
import { useFoodIntolerances } from "@/hooks/use-food-intolerances";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { api, apiDownload, isNotFoundError, parseExportFailures } from "@/lib/api";
import { apiErrorText, errorText } from "@/lib/api-error-text";
import {
  type ApplicationWorkspace,
  applicationStatusLabel,
  applicationStatusTone,
  rowsForWorkspace,
  statusesForWorkspace,
} from "@/lib/application-workflow";
import type { FormSection, ResponseRow, TemplateField } from "@/lib/applications";
import { pickText, useLocale } from "@/lib/i18n";
import { useCan, useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
import { buildResponseColumns } from "./response-columns";
import { answerValues, hasDietaryRestrictions, matchesResponseSearch } from "./response-filters";
import { ScoreSelection } from "./score-selection";
import { SendDecisionsModal } from "./send-decisions-modal";
import { useCatalogueNames } from "./use-catalogue-names";
import { useResponseSelection } from "./use-response-selection";

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
  reviewHiddenFields,
  onStandardViewSaved,
  workspace,
}: {
  id: number;
  template: TemplateField[] | null;
  sections: FormSection[];
  askShirtSize: boolean;
  askFoodIntolerances: boolean;
  reviewHiddenFields: string[];
  onStandardViewSaved: () => void;
  workspace: ApplicationWorkspace;
}) {
  const { t, language } = useLocale();
  const me = useMe();
  const isMobile = useIsMobile();
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const canExportFiles = useCan(CAPABILITIES.EXPORTS_RUN);
  const fileFields = useMemo(() => (template ?? []).filter((f) => f.kind === "file"), [template]);
  // Soft, in-place refresh when a response changes (submitted, reviewed,
  // decided) elsewhere. A failed background refetch keeps the table and the
  // reviewer's selection (#1012).
  const {
    data: responsesData,
    error,
    loading,
    stale,
    refetch,
  } = useLiveQuery(
    (signal) =>
      api.get<{ responses: ResponseRow[] }>(`/api/applications/${id}/responses`, { signal }),
    domainScope(SSE_TOPICS.APPLICATIONS),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["applications", id, "responses"] },
  );
  const allRows = useMemo(() => responsesData?.responses ?? [], [responsesData]);
  const hasLoaded = responsesData !== null;
  const loadError =
    error && (responsesData === null || isNotFoundError(error))
      ? apiErrorText(error, t, t("couldNotLoadResponses"))
      : null;
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const { selectedId, setSelectedId } = useResponseSelection();
  const [answerFilters, setAnswerFilters] = useState<Record<string, string[]>>({});
  const [dietaryFilter, setDietaryFilter] = useState<string[]>([]);
  const { intolerances } = useFoodIntolerances();
  const catalogueNames = useCatalogueNames(allRows, template);
  const [decisionStatusOverrides, setDecisionStatusOverrides] = useState<Record<number, string>>(
    {},
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // A new snapshot clears optimistic decisions and keeps the reviewer's
  // selection, dropping rows that no longer exist (#1012).
  const [syncedResponses, setSyncedResponses] = useState(responsesData);
  if (responsesData !== syncedResponses) {
    setSyncedResponses(responsesData);
    setDecisionStatusOverrides({});
    const remaining = new Set(allRows.map((row) => String(row.id)));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((rowId) => remaining.has(rowId)));
      return next.size === current.size ? current : next;
    });
  }
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
    return rowsForWorkspace(allRows, workspace).filter(
      (row) =>
        (statusFilter.length === 0 || statusFilter.includes(row.status)) &&
        matchesResponseSearch(row, search) &&
        (dietaryFilter.length === 0 ||
          dietaryFilter.includes(hasDietaryRestrictions(row) ? "yes" : "no")) &&
        Object.entries(answerFilters).every(
          ([key, values]) =>
            values.length === 0 ||
            answerValues(
              key === "food_intolerances"
                ? row.food_intolerances
                : key === "shirt_size"
                  ? row.shirt_size
                  : row.responses[key],
            ).some((value) => values.includes(value)),
        ),
    );
  }, [allRows, workspace, statusFilter, search, dietaryFilter, answerFilters]);

  // Keep the table snapshot stable while a response modal is open: accepting a
  // review moves it out of this workspace, and the reviewer should still be
  // able to navigate the familiar set and use undo.
  const reloadUnlessModalOpen = () => {
    if (selectedId === null) refetch();
  };

  const selected = useMemo(() => {
    const row = allRows.find((r) => r.id === selectedId);
    if (!row) return null;
    const status = decisionStatusOverrides[row.id];
    return status && status !== row.status ? { ...row, status } : row;
  }, [decisionStatusOverrides, allRows, selectedId]);
  const selectedIndex = useMemo(
    () => visibleRows.findIndex((r) => r.id === selectedId),
    [visibleRows, selectedId],
  );

  const columns = buildResponseColumns({ t, meId: me?.id, workspace });

  function fileLabel(field: TemplateField) {
    const label = pickText(field.label, language).trim();
    return label && label !== field.key && !/^field_\d+$/.test(label)
      ? label
      : t("exportMenuAttachment", { number: fileFields.indexOf(field) + 1 });
  }

  // Downloads via fetch (not a plain <a href>) so the x-export-file-failures
  // response header can be read and surfaced: browsers give JS no way to
  // inspect headers of a navigation-triggered download (H56 follow-up: report
  // + let staff manually handle failures).
  async function exportField(field: TemplateField, scope: "all" | "shared") {
    setExportingKey(`${field.key}:${scope}`);
    try {
      const headers = await apiDownload(
        `/api/applications/${id}/fields/${encodeURIComponent(field.key)}/files.zip?scope=${scope}`,
        `${field.key}-${scope}.zip`,
      );
      const failures = parseExportFailures<{ total: number; items: ExportFileFailure[] }>(headers);
      if (failures) {
        setExportFailures({
          fieldKey: field.key,
          fieldLabel: fileLabel(field),
          total: failures.total,
          items: failures.items,
        });
        toast.error(t("exportFilesFailedToast", { count: failures.total }), t("exportFiles"));
      } else {
        toast.success(t("exportFilesDownloaded"), { compactTitle: t("exportFiles") });
      }
    } catch (err) {
      toast.error(errorText(err, t, t("exportFailed")), t("exportFiles"));
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
      setSelectedIds(new Set());
      reloadUnlessModalOpen();
      if (skipped.length === 0) toast.success(label, { compactTitle: t("toastDecisions") });
    } catch (err) {
      toast.error(apiErrorText(err, t, t("batchActionFailed")), t("toastDecisions"));
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
        searchOwnRowWhenNarrow
        search={{
          id: "response-search",
          label: t("searchResponses"),
          placeholder: t("searchApplicantsOrReviews"),
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
          ...(askShirtSize
            ? [
                {
                  id: "shirt-size",
                  label: t("shirtSize"),
                  icon: FileTextIcon,
                  type: "multiple" as const,
                  value: answerFilters.shirt_size ?? [],
                  onChange: (value: string[]) => {
                    setAnswerFilters((current) => ({ ...current, shirt_size: value }));
                    setSelectedIds(new Set());
                  },
                  options: [...new Set(allRows.flatMap((row) => answerValues(row.shirt_size)))]
                    .sort((a, b) => a.localeCompare(b, language))
                    .map((value) => ({ value, label: value })),
                },
              ]
            : []),
          ...(askFoodIntolerances
            ? [
                {
                  id: "dietary",
                  label: t("dietaryRestrictions"),
                  icon: ChecksIcon,
                  type: "multiple" as const,
                  value: dietaryFilter,
                  onChange: (value: string[]) => {
                    setDietaryFilter(value);
                    setSelectedIds(new Set());
                  },
                  options: [
                    { value: "yes", label: t("withDietaryRestrictions") },
                    { value: "no", label: t("withoutDietaryRestrictions") },
                  ],
                },
                {
                  id: "dietary-kind",
                  label: t("foodIntolerances"),
                  icon: ChecksIcon,
                  type: "multiple" as const,
                  value: answerFilters.food_intolerances ?? [],
                  onChange: (value: string[]) => {
                    setAnswerFilters((current) => ({ ...current, food_intolerances: value }));
                    setSelectedIds(new Set());
                  },
                  options: intolerances.map((item) => ({
                    value: String(item.id),
                    label: pickText(item.label, language),
                  })),
                },
              ]
            : []),
          ...(template ?? [])
            .filter(
              (field) =>
                field.kind !== "file" &&
                field.kind !== "images" &&
                field.key !== "food_intolerances" &&
                field.key !== "shirt_size",
            )
            .map((field) => ({
              id: `answer:${field.key}`,
              label: pickText(field.label, language),
              icon: FileTextIcon,
              type: "multiple" as const,
              value: answerFilters[field.key] ?? [],
              onChange: (value: string[]) => {
                setAnswerFilters((current) => ({ ...current, [field.key]: value }));
                setSelectedIds(new Set());
              },
              options: [
                ...new Set(allRows.flatMap((row) => answerValues(row.responses[field.key]))),
              ]
                .map((value) => ({
                  value,
                  label:
                    field.kind === "checkbox"
                      ? value === "true"
                        ? t("yesLabel")
                        : t("noLabel")
                      : (catalogueNames[`${field.kind}:${value}`] ??
                        (field.options?.find((option) => option.value === value)
                          ? pickText(
                              field.options.find((option) => option.value === value)!.label,
                              language,
                            )
                          : value)),
                }))
                .sort((a, b) => a.label.localeCompare(b.label, language)),
            })),
        ]}
        actions={
          (canExportFiles || canDecide) && (
            <ActionGroup className="justify-end">
              {canDecide && (
                <ScoreSelection
                  rows={rows}
                  onSelect={setSelectedIds}
                  disabled={loading || batchBusy || Boolean(loadError)}
                />
              )}
              {canExportFiles && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="max-sm:gap-1 max-sm:px-2 max-sm:text-xs max-sm:has-[>svg:first-child]:pl-2"
                      aria-label={t("export")}
                      ref={exportTriggerRef}
                    >
                      <DownloadSimpleIcon aria-hidden="true" />
                      {t("export")}
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
      {selectedId !== null && hasLoaded && !selected && !loadError && (
        <Alert>
          <AlertTitle>{t("responseLinkUnavailable")}</AlertTitle>
          <Button variant="outline" size="sm" onClick={() => setSelectedId(null)}>
            {t("close")}
          </Button>
        </Alert>
      )}
      {stale && <StaleDataNotice onRetry={() => refetch()} />}
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
              <StatusBadge tone={applicationStatusTone(row.status)}>
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
        tableClassName={workspace === "sent" ? "min-w-[64rem]" : undefined}
        data={rows}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: () => refetch() } : undefined}
        onRowClick={(r) => setSelectedId(r.id)}
        getRowLabel={(r) => r.name ?? r.email}
        selectable={canDecide}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onVisibleRowsChange={setVisibleRows}
        pageSize={15}
        empty={{
          title: t("noResponsesTitle"),
          description:
            statusFilter.length === 0 &&
            !search.trim() &&
            dietaryFilter.length === 0 &&
            !Object.values(answerFilters).some((values) => values.length > 0)
              ? t("submissionsAppearHereDesc")
              : t("noResponsesMatchFilterDesc"),
        }}
        filteredEmpty={{
          active:
            statusFilter.length > 0 ||
            search.trim().length > 0 ||
            dietaryFilter.length > 0 ||
            Object.values(answerFilters).some((values) => values.length > 0),
          onClear: () => {
            setStatusFilter([]);
            setAnswerFilters({});
            setDietaryFilter([]);
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
          reviewHiddenFields={reviewHiddenFields}
          onStandardViewSaved={onStandardViewSaved}
          askFoodIntolerances={askFoodIntolerances}
          onClose={() => {
            setSelectedId(null);
            setDecisionStatusOverrides({});
            refetch();
          }}
          onChanged={() => refetch()}
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
        <SendDecisionsModal
          id={id}
          open={sendOpen}
          onOpenChange={setSendOpen}
          onSent={reloadUnlessModalOpen}
        />
      )}
    </div>
  );
}
