"use client";

import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type Translate, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import { FIELD_KINDS, FILE_KIND, type FieldKind, OPTION_KINDS, type TemplateField } from "../lib";
import { generatedFieldKey } from "../workflow";
import { LOCALES } from "./locales";
import { OptionsEditor } from "./options-editor";

function fieldKindLabel(kind: FieldKind, t: Translate): string {
  const map: Record<FieldKind, string> = {
    text: t("fieldKindText"),
    textarea: t("fieldKindTextarea"),
    select: t("fieldKindSelect"),
    multiselect: t("fieldKindMultiselect"),
    checkbox: t("fieldKindCheckbox"),
    date: t("fieldKindDate"),
    number: t("fieldKindNumber"),
    "file-url": t("fieldKindFileUrl"),
    file: t("fieldKindFile"),
    university: t("fieldKindUniversity"),
  };
  return map[kind];
}

export function FieldEditor({
  field,
  index,
  count,
  primaryLocale,
  existingKeys,
  onChange,
  onKind,
  onMove,
  onRemove,
}: {
  field: TemplateField;
  index: number;
  count: number;
  primaryLocale: Language;
  existingKeys: string[];
  onChange: (patch: Partial<TemplateField>) => void;
  onKind: (kind: FieldKind) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
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

  const setOptions = (options: TemplateField["options"]) => onChange({ options });

  return (
    <div className="border-border space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs font-medium">#{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon className="size-4" />
            <span className="sr-only">{t("moveUp")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon className="size-4" />
            <span className="sr-only">{t("moveDown")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive size-8"
            onClick={onRemove}
          >
            <Trash2Icon className="size-4" />
            <span className="sr-only">{t("removeAction")}</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`question-${index}-${primaryLocale}`}>{t("primaryApplicantLabel")}</Label>
          <Input
            id={`question-${index}-${primaryLocale}`}
            value={field.label[primaryLocale]}
            onChange={(e) => setLabel(primaryLocale, e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("kindLabel")}</Label>
          <Select value={field.kind} onValueChange={(v) => onKind(v as FieldKind)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {fieldKindLabel(k, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("translationsAndSettings")}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`question-${index}-${loc}`}>{loc.toUpperCase()}</Label>
                <Input
                  id={`question-${index}-${loc}`}
                  value={field.label[loc]}
                  onChange={(e) => setLabel(loc, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`field-key-${index}`}>{t("fieldKeyLabel")}</Label>
            <Input
              id={`field-key-${index}`}
              value={field.key}
              onChange={(e) => onChange({ key: e.target.value })}
              aria-describedby={`field-key-hint-${index}`}
            />
            <p id={`field-key-hint-${index}`} className="text-muted-foreground text-xs">
              {t("generatedAutomatically")}
            </p>
          </div>
        </div>
      </details>

      {OPTION_KINDS.includes(field.kind) && (
        <OptionsEditor
          options={field.options ?? []}
          primaryLocale={primaryLocale}
          onChange={setOptions}
        />
      )}

      {field.kind === FILE_KIND && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("fileRestrictions")}</summary>
          <div className="mt-3">
            <FileRestrictionsEditor field={field} onChange={onChange} />
          </div>
        </details>
      )}

      <div className="flex items-center gap-2">
        <Switch
          checked={field.required}
          onCheckedChange={(v) => onChange({ required: v })}
          id={`required-${index}`}
        />
        <Label htmlFor={`required-${index}`} className="text-sm">
          {t("required")}
        </Label>
      </div>
    </div>
  );
}
/** Upload restrictions for a "file" field: allowed extensions + size cap (H12). */
function FileRestrictionsEditor({
  field,
  onChange,
}: {
  field: TemplateField;
  onChange: (patch: Partial<TemplateField>) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="border-border grid gap-4 rounded-md border border-dashed p-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs uppercase">
          {t("allowedFileTypesLabel")}
        </Label>
        <Input
          value={(field.allowed_file_types ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              allowed_file_types: e.target.value
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            })
          }
          placeholder=".pdf, .png, .jpg"
        />
        <p className="text-muted-foreground text-xs">{t("allowedFileTypesDesc")}</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs uppercase">{t("maxSizeMbLabel")}</Label>
        <Input
          type="number"
          min={1}
          value={field.max_file_size_mb ?? ""}
          onChange={(e) =>
            onChange({ max_file_size_mb: e.target.value ? Number(e.target.value) : undefined })
          }
          placeholder="10"
        />
        <p className="text-muted-foreground text-xs">{t("blankMax10MbDesc")}</p>
      </div>
    </div>
  );
}
