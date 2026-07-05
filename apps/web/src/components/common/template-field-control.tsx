"use client";

// One control for a single application-template field, shared by the applicant
// form (my-applications) and staff response editing (applications). Renders by
// field.kind and owns the type contracts the API's validateResponses enforces:
// number for "number"/"university", string for text/file, string[] for
// multiselect, boolean for checkbox. The university id is kept numeric here so
// callers never have to remember the string↔number dance.

import { FileLink } from "@/components/common/file-link";
import { FileUploadField } from "@/components/common/file-upload-field";
import { MultiSelect } from "@/components/common/multi-select";
import { UniversityPicker } from "@/components/common/university-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { I18nText } from "@/lib/i18n";
import { pickText } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export type FieldValue = string | number | boolean | string[] | null | undefined;

/** Structural shape shared by both modules' local TemplateField types. */
export interface TemplateFieldLike {
  key: string;
  label: I18nText;
  kind: string;
  required: boolean;
  options?: { value: string; label: I18nText }[];
  allowed_file_types?: string[];
  max_file_size_mb?: number;
}

const NONE = "__none__";

export function TemplateFieldControl({
  field,
  value,
  onChange,
  disabled,
  lang,
  error,
  applicationId,
  inDialog = false,
}: {
  field: TemplateFieldLike;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  disabled?: boolean;
  lang: Language;
  error?: string;
  /**
   * Enables direct file upload for the "file" kind (the applicant owns the
   * response). Omit for staff editing — the upload route stores under the
   * caller's user id, so staff see the current file read-only instead.
   */
  applicationId?: number;
  inDialog?: boolean;
}) {
  const label = pickText(field.label, lang);
  const options = (field.options ?? []).map((o) => ({
    value: o.value,
    label: pickText(o.label, lang),
  }));

  let control: React.ReactNode;
  switch (field.kind) {
    case "textarea":
      control = (
        <Textarea
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "select": {
      const current = typeof value === "string" && value ? value : NONE;
      control = (
        <Select
          value={current}
          onValueChange={(v) => onChange(v === NONE ? "" : v)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {!field.required && <SelectItem value={NONE}>—</SelectItem>}
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    }
    case "multiselect":
      control = (
        <MultiSelect
          options={options}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(v) => onChange(v)}
          disabled={disabled}
          inDialog={inDialog}
        />
      );
      break;
    case "checkbox":
      control = (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`cb-${field.key}`}
            checked={value === true}
            onCheckedChange={(c) => onChange(c === true)}
            disabled={disabled}
          />
          <Label htmlFor={`cb-${field.key}`} className="text-sm font-normal">
            {label}
          </Label>
        </div>
      );
      break;
    case "date":
      control = (
        <Input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "number":
      control = (
        <Input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          disabled={disabled}
        />
      );
      break;
    case "file-url":
      control = (
        <Input
          type="url"
          placeholder="https://…"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "file":
      // Applicant (applicationId set): upload. Staff editing: read-only link.
      control =
        applicationId != null ? (
          <FileUploadField
            applicationId={applicationId}
            fieldKey={field.key}
            value={typeof value === "string" ? value : ""}
            onChange={(url) => onChange(url)}
            allowedTypes={field.allowed_file_types}
            maxSizeMb={field.max_file_size_mb}
            disabled={disabled}
          />
        ) : value ? (
          <FileLink value={String(value)} />
        ) : (
          <p className="text-muted-foreground text-sm">No file uploaded.</p>
        );
      break;
    case "university":
      // The API stores/validates a university as a numeric id; the picker works
      // in string ids — convert on the way in and out.
      control = (
        <UniversityPicker
          value={value != null && value !== "" ? String(value) : ""}
          onChange={(v) => onChange(v ? Number(v) : null)}
          disabled={disabled}
          inDialog={inDialog}
        />
      );
      break;
    default:
      control = (
        <Input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
  }

  return (
    <div className="space-y-2">
      {/* The checkbox kind renders its own inline label. */}
      {field.kind !== "checkbox" && (
        <Label>
          {label}
          {field.required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      {control}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
