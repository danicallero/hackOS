"use client";

// Editor card for one application question (H11): label, kind, options, validation, retention.

import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CaretUpIcon } from "@phosphor-icons/react/dist/csr/CaretUp";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsThreeVertical";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useId, useRef } from "react";
import { flushSync } from "react-dom";
import { IconButton } from "@/components/common/icon-button";
import { LibraryManager } from "@/components/common/library-manager";
import {
  FieldKindIcon,
  fieldKindLabel,
  TYPED_KINDS,
} from "@/components/forms/field-editor/field-kinds";
import { FileRestrictionsEditor } from "@/components/forms/field-editor/file-restrictions-editor";
import { OptionsEditor } from "@/components/forms/field-editor/options-editor";
import { ValidationEditor } from "@/components/forms/field-editor/validation-editor";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Surface } from "@/components/ui/surface";
import { Switch } from "@/components/ui/switch";
import { VALIDATABLE_KINDS } from "@/lib/application-field-serialize";
import { LOCALES } from "@/lib/application-form";
import { generatedFieldKey } from "@/lib/application-workflow";
import {
  FIELD_KINDS,
  FILE_KIND,
  type FieldKind,
  type FieldValidation,
  type FormSection,
  OPTION_KINDS,
  type TemplateField,
} from "@/lib/applications";
import { useLocale } from "@/lib/i18n";
import { EMPTY_I18N } from "@/lib/i18n-text";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FieldEditor({
  fieldId,
  formId,
  onLibraryDirtyChange,
  field,
  availableSections = [],
  index,
  count,
  primaryLocale,
  existingKeys,
  dragHandle,
  projectMode = false,
  active,
  onActivate,
  onDeactivate,
  onChange,
  onKind,
  onMove,
  onDuplicate,
  onRemove,
}: {
  fieldId?: string;
  field: TemplateField;
  availableSections?: FormSection[];
  index: number;
  count: number;
  formId?: number;
  onLibraryDirtyChange?: (dirty: boolean) => void;
  primaryLocale: Language;
  existingKeys: string[];
  dragHandle?: React.ReactNode;
  /** H16: project forms reuse this engine without application-only controls (retention, statistics, CV, sponsor sharing). */
  projectMode?: boolean;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onChange: (patch: Partial<TemplateField>) => void;
  onKind: (kind: FieldKind) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  const uid = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const expandedHeaderRef = useRef<HTMLDivElement>(null);
  const statisticsEnabled = field.statistics?.enabled === true;

  const changeActivePreservingPosition = (change: () => void, anchorBefore: HTMLElement | null) => {
    const beforeTop = anchorBefore?.getBoundingClientRect().top;
    flushSync(change);
    if (beforeTop === undefined) return;
    const afterTop = cardRef.current?.getBoundingClientRect().top;
    if (afterTop !== undefined) window.scrollBy({ top: afterTop - beforeTop });
  };

  const topRow = (
    <div
      ref={active ? expandedHeaderRef : undefined}
      className={cn(
        "flex items-center gap-1 rounded-control py-1",
        active && "bg-card sticky top-2 z-10 border-b border-border/60",
      )}
    >
      {dragHandle}
      <FieldKindIcon kind={field.kind} className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 wrap-break-word px-1 text-sm font-medium">
        {active ? fieldKindLabel(field.kind, t) : field.label[primaryLocale] || field.key}
      </span>
      <IconButton
        type="button"
        variant="ghost"
        size="icon-sm"
        label={t("moveUp")}
        disabled={index === 0}
        onClick={(e) => {
          e.stopPropagation();
          onMove(-1);
        }}
      >
        <ArrowUpIcon className="size-3.5" aria-hidden="true" />
      </IconButton>
      <IconButton
        type="button"
        variant="ghost"
        size="icon-sm"
        label={t("moveDown")}
        disabled={index === count - 1}
        onClick={(e) => {
          e.stopPropagation();
          onMove(1);
        }}
      >
        <ArrowDownIcon className="size-3.5" aria-hidden="true" />
      </IconButton>
      {!active && (
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label={`${t("edit")}: ${field.label[primaryLocale] || field.key}`}
          onClick={() => changeActivePreservingPosition(onActivate, cardRef.current)}
        >
          <PencilSimpleIcon aria-hidden="true" className="size-4" />
        </IconButton>
      )}
      {active && (
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label={t("collapseQuestion")}
          onClick={(event) => {
            event.stopPropagation();
            changeActivePreservingPosition(onDeactivate, expandedHeaderRef.current);
          }}
        >
          <CaretUpIcon className="size-4" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );

  if (!active) {
    return (
      <Surface
        ref={cardRef}
        data-field-id={fieldId}
        padding="compact"
        className="hover:border-primary/40 cursor-pointer space-y-1"
        onClick={(event) => {
          if (
            (event.target as HTMLElement).closest(
              "button, a, input, textarea, select, [role=button], [role=combobox]",
            )
          )
            return;
          changeActivePreservingPosition(onActivate, cardRef.current);
        }}
      >
        {topRow}
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{fieldKindLabel(field.kind, t)}</span>
          {field.required && <span>{t("required")}</span>}
          {projectMode && field.project_description && (
            <span>{t("projectDescriptionFieldLabel")}</span>
          )}
          {projectMode && field.project_video && <span>{t("projectVideoField")}</span>}
          {projectMode && field.judging_link && <span>{t("projectJudgingLinkField")}</span>}
        </p>
      </Surface>
    );
  }

  const setLabel = (loc: (typeof LOCALES)[number], val: string) => {
    const followsGeneratedKey =
      /^field_\d+$/.test(field.key) ||
      field.key === generatedFieldKey(field.label[primaryLocale], existingKeys);
    onChange({
      label: { ...field.label, [loc]: val },
      ...(loc === primaryLocale && followsGeneratedKey
        ? { key: generatedFieldKey(val, existingKeys) }
        : {}),
    });
  };
  const setHelpText = (loc: (typeof LOCALES)[number], val: string) =>
    onChange({ help_text: { ...(field.help_text ?? EMPTY_I18N), [loc]: val } });
  const setPlaceholder = (loc: (typeof LOCALES)[number], val: string) =>
    onChange({ placeholder: { ...(field.placeholder ?? EMPTY_I18N), [loc]: val } });

  const setOptions = (options: TemplateField["options"]) => onChange({ options });
  const setValidation = (patch: Partial<FieldValidation>) =>
    onChange({ validation: { ...field.validation, ...patch } });
  const canValidate = VALIDATABLE_KINDS.has(field.kind);

  return (
    <Surface
      ref={cardRef}
      data-field-id={fieldId}
      padding="compact"
      onClick={(e) => e.stopPropagation()}
      className="border-l-primary scroll-mt-20 space-y-4 border-l-4"
    >
      {topRow}

      <div className="grid items-start gap-3 @lg:grid-cols-[minmax(0,1fr)_12rem_9rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`field-label-${uid}`}>
            {t(projectMode ? "projectQuestionLabel" : "primaryApplicantLabel")}
          </Label>
          <Input
            id={`field-label-${uid}`}
            placeholder={t(projectMode ? "projectQuestionLabel" : "primaryApplicantLabel")}
            value={field.label[primaryLocale]}
            onChange={(e) => setLabel(primaryLocale, e.target.value)}
            className="text-base font-medium"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`field-kind-${uid}`}>{t("kindLabel")}</Label>
          <Select value={field.kind} onValueChange={(v) => onKind(v as FieldKind)}>
            <SelectTrigger id={`field-kind-${uid}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_KINDS.filter((k) => projectMode || k !== "images").map((k) => (
                <SelectItem key={k} value={k}>
                  <span className="flex items-center gap-2">
                    <FieldKindIcon kind={k} className="text-muted-foreground size-4 shrink-0" />
                    {fieldKindLabel(k, t)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`required-${uid}`}>{t("required")}</Label>
          <div className="flex items-center py-2">
            <Switch
              id={`required-${uid}`}
              checked={field.required}
              onCheckedChange={(required) => onChange({ required })}
            />
          </div>
        </div>
      </div>

      {availableSections.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor={`field-section-${uid}`}>{t("sections")}</Label>
          <Select
            value={
              field.section_key ??
              (field.after_section_key ? `after-section:${field.after_section_key}` : "__none__")
            }
            onValueChange={(value) =>
              onChange({
                section_key:
                  value === "__none__" || value.startsWith("after-section:") ? undefined : value,
                after_section_key: value.startsWith("after-section:")
                  ? value.slice("after-section:".length)
                  : undefined,
              })
            }
          >
            <SelectTrigger id={`field-section-${uid}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("noSection")}</SelectItem>
              {availableSections.map((section) => (
                <SelectItem key={section.key} value={section.key}>
                  {section.title[primaryLocale] || section.key}
                </SelectItem>
              ))}
              {availableSections.map((section) => (
                <SelectItem
                  key={`after-section:${section.key}`}
                  value={`after-section:${section.key}`}
                >
                  {t("applicationDropAfterSection", {
                    name: section.title[primaryLocale] || section.key,
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {TYPED_KINDS.has(field.kind) && field.placeholder !== undefined && (
        <Input
          aria-label={t("placeholderTextLabel")}
          value={field.placeholder[primaryLocale] ?? ""}
          onChange={(e) => setPlaceholder(primaryLocale, e.target.value)}
          placeholder={t("placeholderTextLabel")}
          className="text-sm"
        />
      )}

      {field.kind === "library" && (
        <LibraryManager
          libraryId={field.library_id}
          onDirtyChange={onLibraryDirtyChange}
          managePath={
            projectMode
              ? `/api/projects/form/libraries/${field.library_id}/manage`
              : `/api/applications/${formId}/libraries/${field.library_id}/manage`
          }
        />
      )}
      {field.help_text !== undefined && (
        <Input
          aria-label={t("descriptionLabel")}
          value={field.help_text[primaryLocale] ?? ""}
          onChange={(e) => setHelpText(primaryLocale, e.target.value)}
          placeholder={t("descriptionLabel")}
          className="text-sm"
        />
      )}

      {OPTION_KINDS.includes(field.kind) && (
        <OptionsEditor
          options={field.options ?? []}
          primaryLocale={primaryLocale}
          onChange={setOptions}
        />
      )}

      <details className="border-t pt-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t("advancedFieldSettings")}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`question-${uid}-${loc}`}>
                  {t(projectMode ? "projectQuestionLabel" : "primaryApplicantLabel")} (
                  {loc.toUpperCase()})
                </Label>
                <Input
                  id={`question-${uid}-${loc}`}
                  value={field.label[loc]}
                  onChange={(e) => setLabel(loc, e.target.value)}
                />
              </div>
            ))}
          </div>
          {field.help_text !== undefined && (
            <div className="grid gap-3 sm:grid-cols-2">
              {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
                <div key={loc} className="space-y-1.5">
                  <Label htmlFor={`question-help-${uid}-${loc}`}>
                    {t("descriptionLabel")} ({loc.toUpperCase()})
                  </Label>
                  <Input
                    id={`question-help-${uid}-${loc}`}
                    value={field.help_text?.[loc] ?? ""}
                    onChange={(e) => setHelpText(loc, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
          {TYPED_KINDS.has(field.kind) && field.placeholder !== undefined && (
            <div className="grid gap-3 sm:grid-cols-2">
              {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
                <div key={loc} className="space-y-1.5">
                  <Label htmlFor={`question-placeholder-${uid}-${loc}`}>
                    {t("placeholderTextLabel")} ({loc.toUpperCase()})
                  </Label>
                  <Input
                    id={`question-placeholder-${uid}-${loc}`}
                    value={field.placeholder?.[loc] ?? ""}
                    onChange={(e) => setPlaceholder(loc, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`field-key-${uid}`}>{t("fieldKeyLabel")}</Label>
            <Input
              id={`field-key-${uid}`}
              value={field.key}
              onChange={(e) => onChange({ key: e.target.value })}
              aria-describedby={`field-key-hint-${uid}`}
            />
            <p id={`field-key-hint-${uid}`} className="text-muted-foreground text-xs">
              {t("generatedAutomatically")}
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-4 border-t pt-4">
          {field.validation && canValidate && (
            <ValidationEditor
              field={field}
              primaryLocale={primaryLocale}
              onChange={setValidation}
            />
          )}
          {!projectMode && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`retention-mode-${uid}`}>{t("anonymousAuditRetentionLabel")}</Label>
                <Select
                  value={field.retention_mode ?? "none"}
                  onValueChange={(value) =>
                    onChange({
                      retention_mode: value as "none" | "anonymous_audit",
                      ...(value === "none" ? { anonymous_audit_dimension: undefined } : {}),
                    })
                  }
                >
                  <SelectTrigger id={`retention-mode-${uid}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("anonymousAuditRetentionOff")}</SelectItem>
                    <SelectItem value="anonymous_audit">
                      {t("anonymousAuditRetentionOn")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">{t("anonymousAuditRetentionHint")}</p>
              </div>
              {field.retention_mode === "anonymous_audit" && (
                <>
                  <p role="alert" className="text-destructive text-pretty text-sm">
                    {t("anonymousAuditRetentionWarning")}
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor={`audit-dimension-${uid}`}>
                      {t("anonymousAuditDimensionLabel")}
                    </Label>
                    <Input
                      id={`audit-dimension-${uid}`}
                      value={field.anonymous_audit_dimension ?? ""}
                      onChange={(e) =>
                        onChange({ anonymous_audit_dimension: e.target.value || null })
                      }
                      placeholder={t("anonymousAuditDimensionPlaceholder")}
                      aria-describedby={`audit-dimension-hint-${uid}`}
                    />
                    <p id={`audit-dimension-hint-${uid}`} className="text-muted-foreground text-xs">
                      {t("anonymousAuditDimensionHint")}
                    </p>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <Label htmlFor={`statistics-enabled-${uid}`} className="text-sm">
                  {t("includeInStatistics")}
                </Label>
                <Switch
                  id={`statistics-enabled-${uid}`}
                  checked={statisticsEnabled}
                  onCheckedChange={(enabled) =>
                    onChange({
                      statistics: {
                        ...(field.statistics ?? {}),
                        enabled,
                      },
                    })
                  }
                />
              </div>
              {statisticsEnabled && (
                <div className="grid gap-3 border-t pt-4 @md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`statistics-visualization-${uid}`}>
                      {t("statisticsVisualizationLabel")}
                    </Label>
                    <Select
                      value={field.statistics?.visualization ?? "bar"}
                      onValueChange={(visualization) =>
                        onChange({
                          statistics: {
                            ...(field.statistics ?? { enabled: true }),
                            enabled: true,
                            visualization: visualization as "bar" | "pie" | "line",
                          },
                        })
                      }
                    >
                      <SelectTrigger id={`statistics-visualization-${uid}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bar">{t("chartTypeBar")}</SelectItem>
                        <SelectItem value="pie">{t("chartTypePie")}</SelectItem>
                        <SelectItem value="line">{t("chartTypeLine")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`statistics-transformation-${uid}`}>
                      {t("statisticsTransformationLabel")}
                    </Label>
                    <Select
                      value={field.statistics?.transformation ?? "none"}
                      onValueChange={(transformation) =>
                        onChange({
                          statistics: {
                            ...(field.statistics ?? { enabled: true }),
                            enabled: true,
                            transformation: transformation as "none" | "age" | "study_level",
                          },
                        })
                      }
                    >
                      <SelectTrigger id={`statistics-transformation-${uid}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("statisticsTransformationNone")}</SelectItem>
                        <SelectItem value="age">{t("statisticsTransformationAge")}</SelectItem>
                        <SelectItem value="study_level">
                          {t("statisticsTransformationStudyLevel")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`statistics-aggregation-${uid}`}>
                      {t("statisticsAggregationLabel")}
                    </Label>
                    <Select
                      value={field.statistics?.aggregation ?? "count"}
                      onValueChange={(aggregation) =>
                        onChange({
                          statistics: {
                            ...(field.statistics ?? { enabled: true }),
                            enabled: true,
                            aggregation: aggregation as "count" | "sum" | "average",
                          },
                        })
                      }
                    >
                      <SelectTrigger id={`statistics-aggregation-${uid}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="count">{t("statisticsAggregationCount")}</SelectItem>
                        <SelectItem value="sum">{t("statisticsAggregationSum")}</SelectItem>
                        <SelectItem value="average">{t("statisticsAggregationAverage")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {field.statistics?.transformation === "study_level" && (
                    <div className="space-y-1.5 @md:col-span-3">
                      <Label htmlFor={`statistics-program-years-${uid}`}>
                        {t("statisticsProgramYearsLabel")}
                      </Label>
                      <Input
                        id={`statistics-program-years-${uid}`}
                        type="number"
                        min={1}
                        max={12}
                        value={field.statistics.program_years ?? 4}
                        onChange={(event) => {
                          const value = event.target.value;
                          onChange({
                            statistics: {
                              ...(field.statistics ?? { enabled: true }),
                              enabled: true,
                              program_years: value === "" ? undefined : Number(value),
                            },
                          });
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {field.kind === FILE_KIND && (
          <div className="border-t pt-4">
            <p className="text-sm font-medium">{t("fileRestrictions")}</p>
            <div className="mt-3">
              <FileRestrictionsEditor field={field} onChange={onChange} projectMode={projectMode} />
            </div>
          </div>
        )}
      </details>

      <Separator />

      <div className="flex flex-wrap items-center gap-1">
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label={t("duplicateQuestion")}
          onClick={onDuplicate}
        >
          <CopyIcon className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label={t("remove")}
          className="text-destructive"
          onClick={onRemove}
        >
          <TrashIcon className="size-4" aria-hidden="true" />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label={t("moreOptions")}
              className="ml-auto"
            >
              <DotsThreeVerticalIcon className="size-4" aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {TYPED_KINDS.has(field.kind) && (
              <DropdownMenuCheckboxItem
                checked={field.placeholder !== undefined}
                onCheckedChange={(checked) =>
                  onChange({ placeholder: checked ? { ...EMPTY_I18N } : undefined })
                }
              >
                {t("placeholderTextLabel")}
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuCheckboxItem
              checked={field.help_text !== undefined}
              onCheckedChange={(checked) =>
                onChange({ help_text: checked ? { ...EMPTY_I18N } : undefined })
              }
            >
              {t("descriptionLabel")}
            </DropdownMenuCheckboxItem>
            {canValidate && (
              <DropdownMenuCheckboxItem
                checked={!!field.validation}
                onCheckedChange={(checked) => onChange({ validation: checked ? {} : undefined })}
              >
                {t("responseValidation")}
              </DropdownMenuCheckboxItem>
            )}
            {projectMode && field.kind === "text" && (
              <DropdownMenuCheckboxItem
                checked={field.project_video ?? false}
                onCheckedChange={(checked) => onChange({ project_video: checked })}
              >
                {t("projectVideoField")}
              </DropdownMenuCheckboxItem>
            )}
            {projectMode && field.kind === "text" && (
              <DropdownMenuCheckboxItem
                checked={field.judging_link ?? false}
                onCheckedChange={(checked) => onChange({ judging_link: checked })}
              >
                {t("projectJudgingLinkField")}
              </DropdownMenuCheckboxItem>
            )}
            {projectMode && (field.kind === "text" || field.kind === "textarea") && (
              <DropdownMenuCheckboxItem
                checked={field.project_description ?? false}
                onCheckedChange={(checked) => onChange({ project_description: checked })}
              >
                {t("projectDescriptionFieldLabel")}
              </DropdownMenuCheckboxItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Surface>
  );
}
