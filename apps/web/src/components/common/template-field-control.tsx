"use client";

// One control for a single application-template field, shared by the applicant
// form (my-applications) and staff response editing (applications). Owns the
// type contracts the API's validateResponses enforces: number for
// "number"/"birth_year"/"university"/"degree", string for text/file, a
// city/province/country object for city, string[] for
// multiselect, boolean for checkbox.

import { CityPicker } from "@/components/common/city-picker";
import { DateTimeInput } from "@/components/common/datetime-input";
import { DegreePicker } from "@/components/common/degree-picker";
import { FileLink } from "@/components/common/file-link";
import { FileUploadField } from "@/components/common/file-upload-field";
import { LinkifiedText } from "@/components/common/linkified-text";
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
import { pickText, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export type FieldValue =
  | string
  | number
  | boolean
  | string[]
  | { city: string; province: string; country: string }
  | null
  | undefined;

/** Structural shape shared by both modules' local TemplateField types. */
export interface TemplateFieldLike {
  key: string;
  label: I18nText;
  kind: string;
  required: boolean;
  options?: { value: string; label: I18nText }[];
  allowed_file_types?: string[];
  max_file_size_mb?: number;
  /** For kind "file": lets the applicant consent to sharing this upload with
   *  sponsors (H56); see sponsorShareKey for the response-key convention. */
  shareable_with_sponsors?: boolean;
  /** Small helper text shown under the field (H11); URLs are auto-linked. */
  help_text?: I18nText;
  /** Placeholder shown inside the empty input, for kinds the applicant types
   *  into (text/textarea/number). Falls back to a generic string. */
  placeholder?: I18nText;
  validation?: {
    text_condition?: string;
    min_length?: number;
    max_length?: number;
  };
}

const NONE = "__none__";
const MAXIMUM_BIRTH_AGE = 120;

/**
 * Template URL validation accepts a hostname without a protocol. Browsers,
 * however, interpret that form as an internal relative path, so add HTTPS
 * before rendering a submitted answer as a link.
 */
export function externalUrlHref(value: string): string | null {
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Stable ids let labels, validation messages, and focus recovery share one contract. */
export function templateFieldId(fieldKey: string, applicationId?: number): string {
  const scope = applicationId == null ? "staff" : `application-${applicationId}`;
  const safeKey = fieldKey.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `template-field-${scope}-${safeKey}`;
}

export function TemplateFieldControl({
  field,
  value,
  onChange,
  disabled,
  lang,
  error,
  applicationId,
  inDialog = false,
  sharedWithSponsors,
  onSharedWithSponsorsChange,
  onExternalLinkClick,
  onBlur,
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
  /**
   * H56: whether the applicant has consented to share this "file" field's
   * upload with sponsors. Only rendered when field.shareable_with_sponsors —
   * a checkbox when applicationId is set (applicant editing), a read-only
   * badge otherwise (staff view).
   */
  sharedWithSponsors?: boolean;
  onSharedWithSponsorsChange?: (value: boolean) => void;
  /** Called when a read-only URL answer is opened in a new tab. */
  onExternalLinkClick?: () => void;
  onBlur?: () => void;
}) {
  const { t } = useLocale();
  const label = pickText(field.label, lang);
  const options = (field.options ?? []).map((o) => ({
    value: o.value,
    label: pickText(o.label, lang),
  }));
  const helpText = field.help_text ? pickText(field.help_text, lang) : "";
  const customPlaceholder = field.placeholder ? pickText(field.placeholder, lang) : "";
  const id = templateFieldId(field.key, applicationId);
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const hasError = Boolean(error);
  const externalUrl = typeof value === "string" ? value.trim() : "";
  const externalUrlHrefValue = externalUrl ? externalUrlHref(externalUrl) : null;
  const isReadOnlyUrl =
    disabled &&
    (field.kind === "text" || field.kind === "textarea") &&
    field.validation?.text_condition === "url" &&
    externalUrlHrefValue !== null;
  const describedBy =
    [helpText ? helpId : null, hasError ? errorId : null].filter(Boolean).join(" ") || undefined;

  let control: React.ReactNode;
  switch (field.kind) {
    case "textarea":
      control = isReadOnlyUrl ? (
        <a
          href={externalUrlHrefValue}
          target="_blank"
          rel="noreferrer"
          className="text-primary block break-all text-sm underline underline-offset-4"
          onClick={onExternalLinkClick}
        >
          {externalUrl}
        </a>
      ) : (
        <Textarea
          id={id}
          name={field.key}
          rows={4}
          placeholder={customPlaceholder || undefined}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          aria-required={field.required || undefined}
        />
      );
      break;
    case "select": {
      const current = typeof value === "string" && value ? value : NONE;
      control = (
        <Select
          value={current}
          onValueChange={(v) => onChange(v === NONE ? "" : v)}
          onOpenChange={(open) => !open && onBlur?.()}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            className="w-full"
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            aria-invalid={hasError || undefined}
            aria-required={field.required || undefined}
          >
            <SelectValue placeholder={t("selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {!field.required && <SelectItem value={NONE}>{t("notSet")}</SelectItem>}
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
          onBlur={onBlur}
          disabled={disabled}
          inDialog={inDialog}
          id={id}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
        />
      );
      break;
    case "checkbox":
      // Unlike other kinds, a checkbox's own label carries the consent text
      // (e.g. "I agree to the Terms and Privacy Policy") and needs actionable
      // links to whatever it's asking the applicant to accept, so — like
      // help_text — bare URLs in it are auto-linked.
      control = (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            name={field.key}
            checked={value === true}
            onCheckedChange={(c) => onChange(c === true)}
            onBlur={onBlur}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            aria-invalid={hasError || undefined}
            aria-required={field.required || undefined}
          />
          <Label id={labelId} htmlFor={id} className="text-sm font-normal">
            <LinkifiedText text={label} />
            {field.required && (
              <>
                <span aria-hidden="true" className="text-destructive ml-0.5">
                  *
                </span>
                <span className="sr-only"> ({t("required")})</span>
              </>
            )}
          </Label>
        </div>
      );
      break;
    case "date":
      control = (
        <DateTimeInput
          type="date"
          // A native date input only shows a yyyy-MM-dd value; slice off any time
          // part so a stored ISO datetime still renders instead of going blank.
          id={id}
          name={field.key}
          value={typeof value === "string" ? value.slice(0, 10) : ""}
          onChange={(v) => onChange(v)}
          onBlur={onBlur}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          aria-required={field.required || undefined}
        />
      );
      break;
    case "birth_year":
      control = (
        <Input
          id={id}
          name={field.key}
          type="number"
          inputMode="numeric"
          min={new Date().getFullYear() - MAXIMUM_BIRTH_AGE}
          max={new Date().getFullYear()}
          step={1}
          placeholder={t("birthYearPlaceholder")}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          onBlur={onBlur}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          aria-required={field.required || undefined}
        />
      );
      break;
    case "number":
      control = (
        <Input
          id={id}
          name={field.key}
          type="number"
          inputMode="numeric"
          placeholder={customPlaceholder || undefined}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          onBlur={onBlur}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          aria-required={field.required || undefined}
        />
      );
      break;
    case "file": {
      // Applicant (applicationId set): upload. Staff editing: read-only link.
      const shareId = `${id}-shared-with-sponsors`;
      control = (
        <div className="space-y-2">
          {applicationId != null ? (
            <FileUploadField
              applicationId={applicationId}
              fieldKey={field.key}
              value={typeof value === "string" ? value : ""}
              onChange={(url) => onChange(url)}
              onBlur={onBlur}
              allowedTypes={field.allowed_file_types}
              maxSizeMb={field.max_file_size_mb}
              disabled={disabled}
              id={id}
              aria-label={t("chooseFileForField", { field: label })}
              aria-labelledby={labelId}
              aria-describedby={describedBy}
              aria-invalid={hasError || undefined}
            />
          ) : value ? (
            <FileLink value={String(value)} />
          ) : (
            <p className="text-muted-foreground text-sm">{t("noFileUploadedPeriod")}</p>
          )}
          {field.shareable_with_sponsors &&
            (applicationId != null ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={shareId}
                  checked={sharedWithSponsors === true}
                  onCheckedChange={(c) => onSharedWithSponsorsChange?.(c === true)}
                  disabled={disabled}
                />
                <Label htmlFor={shareId} className="text-sm font-normal">
                  {t("shareWithSponsorsConsentLabel")}
                </Label>
              </div>
            ) : value ? (
              <p className="text-muted-foreground text-xs">
                {sharedWithSponsors
                  ? t("shareWithSponsorsStaffYes")
                  : t("shareWithSponsorsStaffNo")}
              </p>
            ) : null)}
        </div>
      );
      break;
    }
    case "degree":
      control = (
        <DegreePicker
          value={value != null && value !== "" ? String(value) : ""}
          onChange={(v) => onChange(v ? Number(v) : null)}
          onBlur={onBlur}
          disabled={disabled}
          inDialog={inDialog}
          id={id}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          aria-required={field.required || undefined}
        />
      );
      break;
    case "city":
      control = (
        <CityPicker
          value={
            typeof value === "object" && value !== null && !Array.isArray(value)
              ? {
                  city: typeof value.city === "string" ? value.city : "",
                  province: typeof value.province === "string" ? value.province : "",
                  country: typeof value.country === "string" ? value.country : "",
                }
              : { city: "", province: "", country: "" }
          }
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
          id={id}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          aria-required={field.required || undefined}
        />
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
          id={id}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          aria-required={field.required || undefined}
        />
      );
      break;
    default:
      control = isReadOnlyUrl ? (
        <a
          href={externalUrlHrefValue}
          target="_blank"
          rel="noreferrer"
          className="text-primary block break-all text-sm underline underline-offset-4"
          onClick={onExternalLinkClick}
        >
          {externalUrl}
        </a>
      ) : (
        <Input
          id={id}
          name={field.key}
          type="text"
          placeholder={customPlaceholder || undefined}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          aria-required={field.required || undefined}
        />
      );
  }

  return (
    <div className="space-y-2">
      {/* The checkbox kind renders its own inline label. */}
      {field.kind !== "checkbox" && (
        <Label id={labelId} htmlFor={id}>
          {label}
          {field.required && (
            <>
              <span aria-hidden="true" className="text-destructive ml-0.5">
                *
              </span>
              <span className="sr-only"> ({t("required")})</span>
            </>
          )}
        </Label>
      )}
      {control}
      {helpText && (
        <p id={helpId} className="text-muted-foreground text-xs">
          <LinkifiedText text={helpText} />
        </p>
      )}
      {(field.kind === "text" || field.kind === "textarea") &&
        field.validation?.max_length != null && (
          <p className="text-muted-foreground text-xs tabular-nums">
            {typeof value === "string" ? value.length : 0} / {field.validation.max_length}
          </p>
        )}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
