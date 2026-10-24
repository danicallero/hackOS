"use client";

import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { API_URL } from "@/lib/env";
import type { Translate } from "@/lib/i18n";
import { type I18nText, type MessageKey, pickText, useLocale } from "@/lib/i18n";
import { intentKey, settleIntentKey } from "@/lib/intent-key";
import { toast } from "@/lib/toast";

const EXPORT_STATUSES = [
  "draft",
  "review",
  "accepted_internal",
  "rejected_internal",
  "accepted",
  "rejected",
  "confirmed",
  "declined",
  "expired",
] as const;

type ExportStatus = (typeof EXPORT_STATUSES)[number];
type DocumentScope = "none" | "all" | "shared";

const STATUS_LABEL_KEYS: Record<ExportStatus, MessageKey> = {
  draft: "dataStatusDraft",
  review: "dataStatusReview",
  accepted_internal: "acceptedUnsentStatus",
  rejected_internal: "rejectedUnsentStatus",
  accepted: "dataStatusAccepted",
  rejected: "dataStatusRejected",
  confirmed: "confirmed",
  declined: "declined",
  expired: "dataStatusExpired",
};

interface CatalogField {
  key: string;
  label: I18nText;
  kind?: string;
  shareable_with_sponsors?: boolean;
}

interface CatalogApplication {
  id: number;
  name: string;
  fields: CatalogField[];
}

interface ExportCatalog {
  profile: CatalogField[];
  metadata: CatalogField[];
  applications: CatalogApplication[];
}

interface FieldSelection {
  source: "profile" | "metadata" | "answer";
  key: string;
  application_id?: number;
}

interface FieldOption {
  id: string;
  label: string;
  description: string;
  group: "profile" | "metadata" | "answer";
  selection: FieldSelection;
}

interface MissingFileReport {
  total: number;
  items: Array<{ email: string; responseId: number; fieldKey: string }>;
}

function fieldId(selection: FieldSelection): string {
  return `${selection.source}:${selection.application_id ?? ""}:${selection.key}`;
}

function allFieldIds(catalog: ExportCatalog): string[] {
  return [
    ...catalog.profile.map((field) => fieldId({ source: "profile", key: field.key })),
    ...catalog.metadata.map((field) => fieldId({ source: "metadata", key: field.key })),
    ...catalog.applications.flatMap((application) =>
      application.fields.map((field) =>
        fieldId({ source: "answer", application_id: application.id, key: field.key }),
      ),
    ),
  ];
}

function errorMessage(error: unknown, t: Translate, fallback: string): string {
  return apiErrorText(error, t, fallback);
}

export function ApplicationExportPanel({
  trigger,
  applicationId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onCloseAutoFocus,
}: {
  trigger?: ReactNode;
  applicationId?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: React.ComponentProps<typeof SidePanelEditor>["onCloseAutoFocus"];
}) {
  const { language, t } = useLocale();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [catalog, setCatalog] = useState<ExportCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<ExportStatus[]>([...EXPORT_STATUSES]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [documents, setDocuments] = useState<DocumentScope>("none");
  const [fieldSearch, setFieldSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [exportError, setExportError] = useState<string | null>(null);
  const [missingFiles, setMissingFiles] = useState<MissingFileReport | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const next = await api.get<ExportCatalog>("/api/exports/applications/catalog", {
        query: applicationId ? { application_id: applicationId } : undefined,
      });
      setCatalog(next);
      setSelectedFields(allFieldIds(next));
    } catch (error) {
      const message = errorMessage(error, t, t("applicationExportCatalogFailed"));
      setCatalogError(message);
      toast.error(message, t("toastExportApplications"));
    } finally {
      setCatalogLoading(false);
    }
  }, [applicationId, t]);

  useEffect(() => {
    if (controlledOpen && !catalog && !catalogLoading && !catalogError) void loadCatalog();
  }, [controlledOpen, catalog, catalogLoading, catalogError, loadCatalog]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !catalog && !catalogLoading) void loadCatalog();
    if (!next) {
      setExportError(null);
      setMissingFiles(null);
    }
  };

  const fieldOptions = useMemo<FieldOption[]>(() => {
    if (!catalog) return [];
    const options: FieldOption[] = [];
    for (const field of catalog.profile) {
      const selection = { source: "profile" as const, key: field.key };
      options.push({
        id: fieldId(selection),
        label: pickText(field.label, language),
        description: field.key,
        group: "profile",
        selection,
      });
    }
    for (const field of catalog.metadata) {
      const selection = { source: "metadata" as const, key: field.key };
      options.push({
        id: fieldId(selection),
        label: pickText(field.label, language),
        description: field.key,
        group: "metadata",
        selection,
      });
    }
    for (const application of catalog.applications) {
      for (const field of application.fields) {
        const selection = {
          source: "answer" as const,
          application_id: application.id,
          key: field.key,
        };
        options.push({
          id: fieldId(selection),
          label: pickText(field.label, language),
          description: field.key,
          group: "answer",
          selection,
        });
      }
    }
    return options;
  }, [catalog, language]);

  const fieldGroups = useMemo(
    () => [
      {
        key: "profile" as const,
        label: t("applicationExportProfileFields"),
        options: fieldOptions.filter((option) => option.group === "profile"),
      },
      {
        key: "metadata" as const,
        label: t("applicationExportMetadataFields"),
        options: fieldOptions.filter((option) => option.group === "metadata"),
      },
      ...(catalog?.applications ?? []).map((application) => ({
        key: `application-${application.id}`,
        label: application.name,
        options: fieldOptions.filter(
          (option) => option.selection.application_id === application.id,
        ),
      })),
    ],
    [catalog, fieldOptions, t],
  );

  const filteredGroups = useMemo(() => {
    const query = fieldSearch.trim().toLocaleLowerCase();
    if (!query) return fieldGroups;
    return fieldGroups.map((group) => ({
      ...group,
      options: group.options.filter((option) =>
        `${group.label} ${option.label} ${option.description}`.toLocaleLowerCase().includes(query),
      ),
    }));
  }, [fieldGroups, fieldSearch]);

  const toggleStatus = (status: ExportStatus, checked: boolean) => {
    setSelectedStatuses((current) =>
      checked
        ? current.includes(status)
          ? current
          : [...current, status]
        : current.filter((item) => item !== status),
    );
  };

  const toggleField = (id: string, checked: boolean) => {
    setSelectedFields((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((item) => item !== id),
    );
  };

  const handleExport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setExportError(null);
    setMissingFiles(null);
    if (selectedStatuses.length === 0) {
      setExportError(t("applicationExportNoStatusesSelected"));
      return;
    }
    if (selectedFields.length === 0) {
      setExportError(t("applicationExportNoFieldsSelected"));
      return;
    }
    const selected = fieldOptions.filter((option) => selectedFields.includes(option.id));
    if (selected.length !== selectedFields.length) {
      setExportError(t("applicationExportCatalogFailed"));
      return;
    }

    setExporting(true);
    try {
      const requestBody = JSON.stringify({
        statuses: selectedStatuses,
        fields: selected.map((option) => option.selection),
        ...(applicationId ? { application_ids: [applicationId] } : {}),
        documents,
        language,
      });
      const intent = `POST applications.zip ${requestBody}`;
      const response = await fetch(`${API_URL}/api/exports/applications.zip`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": intentKey(intent),
        },
        body: requestBody,
      });
      settleIntentKey(intent, response.status);

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? t("applicationExportFailed"));
      }

      const failureHeader = response.headers.get("x-export-file-failures");
      let report: MissingFileReport | null = null;
      if (failureHeader) {
        try {
          const parsed = JSON.parse(failureHeader) as MissingFileReport;
          if (parsed.total > 0) report = parsed;
        } catch {
          // The ZIP is still usable; only the optional inline failure report was malformed.
        }
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "applications-export.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMissingFiles(report);
      toast.success(t("applicationExportDownloaded"), {
        compactTitle: t("toastExportApplications"),
      });
      if (report)
        toast.error(
          t("applicationExportMissingFilesDesc", { count: report.total }),
          t("exportFiles"),
        );
    } catch (error) {
      const message = errorMessage(error, t, t("applicationExportFailed"));
      setExportError(message);
      toast.error(message, t("toastExportApplications"));
    } finally {
      setExporting(false);
    }
  };

  const defaultTrigger = (
    <Button variant="outline">
      <DownloadSimpleIcon aria-hidden="true" />
      {t("exportApplicationData")}
    </Button>
  );

  return (
    <SidePanelEditor
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      trigger={trigger ?? defaultTrigger}
      title={t("applicationExportTitle")}
      icon={DownloadSimpleIcon}
      className="sm:max-w-2xl"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <SubmitButton
            form="application-export-form"
            pending={exporting}
            disabled={catalogLoading || !catalog}
          >
            <DownloadSimpleIcon aria-hidden="true" />
            {t("export")}
          </SubmitButton>
        </>
      }
    >
      <form id="application-export-form" onSubmit={handleExport} className="space-y-6">
        {catalogLoading && <p className="text-muted-foreground text-sm">{t("loading")}</p>}

        {catalogError && (
          <Alert variant="destructive">
            <AlertTitle>{t("applicationExportCatalogFailed")}</AlertTitle>
            <AlertDescription>{catalogError}</AlertDescription>
          </Alert>
        )}

        {exportError && (
          <Alert variant="destructive">
            <AlertTitle>{t("applicationExportFailed")}</AlertTitle>
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        )}

        {missingFiles && (
          <Alert variant="destructive">
            <AlertTitle>{t("applicationExportMissingFiles")}</AlertTitle>
            <AlertDescription>
              <p>{t("applicationExportMissingFilesDesc", { count: missingFiles.total })}</p>
              {missingFiles.items.length > 0 && (
                <ul className="list-disc ps-5">
                  {missingFiles.items.slice(0, 5).map((item) => (
                    <li key={`${item.responseId}-${item.fieldKey}`}>
                      {item.email} · {item.fieldKey}
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}

        {catalog && (
          <>
            <fieldset className="space-y-3">
              <legend className="type-meta font-medium text-foreground">
                {t("applicationExportStatuses")}
              </legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground text-sm" role="status" aria-live="polite">
                  {t("selectedCount", { count: selectedStatuses.length })}
                </span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedStatuses([...EXPORT_STATUSES])}
                  >
                    {t("allStatuses")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedStatuses([])}
                  >
                    {t("clear")}
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {EXPORT_STATUSES.map((status) => (
                  <label
                    key={status}
                    htmlFor={`application-export-status-${status}`}
                    className="flex min-h-9 items-center gap-2 rounded-control px-2 py-1.5 hover:bg-muted/50"
                  >
                    <Checkbox
                      id={`application-export-status-${status}`}
                      checked={selectedStatuses.includes(status)}
                      onCheckedChange={(checked) => toggleStatus(status, checked === true)}
                    />
                    <span>{t(STATUS_LABEL_KEYS[status])}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="type-meta font-medium text-foreground">
                {t("applicationExportFields")}
              </legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground text-sm" role="status" aria-live="polite">
                  {t("applicationExportFieldsSelected", { count: selectedFields.length })}
                </span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedFields(fieldOptions.map((option) => option.id))}
                  >
                    {t("selectAll")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedFields([])}
                  >
                    {t("clear")}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="application-export-field-search">
                  {t("applicationExportFieldSearch")}
                </Label>
                <Input
                  id="application-export-field-search"
                  value={fieldSearch}
                  onChange={(event) => setFieldSearch(event.target.value)}
                  placeholder={t("applicationExportFieldSearch")}
                />
              </div>
              <div className="divide-y divide-border" data-export-fields>
                {filteredGroups.every((group) => group.options.length === 0) ? (
                  <p className="text-muted-foreground py-3 text-sm">
                    {t("applicationExportNoMatchingFields")}
                  </p>
                ) : (
                  filteredGroups.map((group) => {
                    if (group.options.length === 0) return null;
                    const selectedCount = group.options.filter((option) =>
                      selectedFields.includes(option.id),
                    ).length;
                    const expanded = fieldSearch.trim().length > 0 || expandedGroups.has(group.key);
                    const groupId = `application-export-group-${group.key}`;
                    return (
                      <div key={group.key} className="py-2">
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`${groupId}-select`}
                            className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-muted/50"
                          >
                            <span className="relative flex shrink-0 items-center justify-center">
                              <Checkbox
                                id={`${groupId}-select`}
                                checked={
                                  selectedCount === group.options.length
                                    ? true
                                    : selectedCount > 0
                                      ? "indeterminate"
                                      : false
                                }
                                className="[&[data-state=indeterminate]_svg]:invisible data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground"
                                onCheckedChange={(checked) => {
                                  const ids = new Set(group.options.map((option) => option.id));
                                  setSelectedFields((current) =>
                                    checked === true
                                      ? [...new Set([...current, ...ids])]
                                      : current.filter((id) => !ids.has(id)),
                                  );
                                }}
                              />
                              {selectedCount > 0 && selectedCount < group.options.length && (
                                <MinusIcon
                                  aria-hidden="true"
                                  className="pointer-events-none absolute size-3.5 text-primary-foreground"
                                />
                              )}
                            </span>
                            <span className="min-w-0 break-words text-sm font-medium">
                              {group.label}
                            </span>
                            <span className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                              {selectedCount}/{group.options.length}
                            </span>
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-11 shrink-0"
                            aria-expanded={expanded}
                            aria-controls={groupId}
                            aria-label={`${t("applicationExportChooseFields")}: ${group.label}`}
                            disabled={fieldSearch.trim().length > 0}
                            onClick={(event) => {
                              const button = event.currentTarget;
                              const scrollContainer = button.closest("form")?.parentElement;
                              const top = button.getBoundingClientRect().top;
                              setExpandedGroups((current) => {
                                const next = new Set(current);
                                if (expanded) next.delete(group.key);
                                else next.add(group.key);
                                return next;
                              });
                              requestAnimationFrame(() => {
                                if (scrollContainer)
                                  scrollContainer.scrollTop +=
                                    button.getBoundingClientRect().top - top;
                              });
                            }}
                          >
                            {t("applicationExportChooseFields")}
                            <CaretDownIcon
                              aria-hidden="true"
                              className={expanded ? "rotate-180" : ""}
                            />
                          </Button>
                        </div>
                        <div id={groupId} hidden={!expanded} className="ps-6 pb-2">
                          {group.options.map((option) => (
                            <label
                              key={option.id}
                              htmlFor={`application-export-field-${encodeURIComponent(option.id)}`}
                              className="flex min-h-10 cursor-pointer items-start gap-3 rounded-control px-2 py-2 hover:bg-muted/50"
                            >
                              <Checkbox
                                id={`application-export-field-${encodeURIComponent(option.id)}`}
                                checked={selectedFields.includes(option.id)}
                                onCheckedChange={(checked) =>
                                  toggleField(option.id, checked === true)
                                }
                              />
                              <span className="min-w-0">
                                <span className="block break-words text-sm">{option.label}</span>
                                <span className="text-muted-foreground block break-all text-xs">
                                  {option.description}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="type-meta font-medium text-foreground">
                {t("applicationExportFiles")}
              </legend>
              <div className="space-y-2">
                {(
                  [
                    ["none", "applicationExportFilesNone", "applicationExportFilesNoneDesc"],
                    ["all", "applicationExportFilesAll", "applicationExportFilesAllDesc"],
                    ["shared", "applicationExportFilesShared", "applicationExportFilesSharedDesc"],
                  ] as const
                ).map(([value, labelKey, descriptionKey]) => (
                  <label
                    key={value}
                    className="flex items-start gap-3 rounded-control border border-border px-3 py-2.5 hover:bg-muted/50"
                  >
                    <input
                      type="radio"
                      name="application-export-documents"
                      value={value}
                      checked={documents === value}
                      onChange={() => setDocuments(value)}
                      className="mt-1 size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{t(labelKey)}</span>
                      <span className="text-muted-foreground block text-sm text-pretty">
                        {t(descriptionKey)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {catalog.applications.length === 0 && (
              <p className="text-muted-foreground text-sm">
                {t("applicationExportNoApplications")}
              </p>
            )}
          </>
        )}
      </form>
    </SidePanelEditor>
  );
}
