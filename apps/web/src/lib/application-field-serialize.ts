import type { I18nText } from "@hackos/shared/questions";
import { FILE_KIND, type FieldKind, OPTION_KINDS, type TemplateField } from "@/lib/applications";

/** Kinds where a response-validation rule (length/pattern/range/selection
 *  count) is meaningful — see `checkFieldValidation` in the API's lib/form-validation.ts. */
export const VALIDATABLE_KINDS = new Set<FieldKind>([
  "text",
  "textarea",
  "number",
  "multiselect",
  "birth_year",
]);

export function hasI18nText(v: I18nText | undefined): v is I18nText {
  return !!v && Object.values(v).some((s) => s.trim());
}

/** Serialize the editor model explicitly so client-only ids never reach the
 * API while every persisted question policy survives a save. */
export function serializeApplicationField(field: TemplateField): TemplateField {
  return {
    key: field.key.trim(),
    ...(field.kind === "library" && field.library_id ? { library_id: field.library_id } : {}),
    label: field.label,
    kind: field.kind,
    required: field.required,
    ...(OPTION_KINDS.includes(field.kind) ? { options: field.options } : {}),
    ...(field.kind === FILE_KIND
      ? {
          ...(field.allowed_file_types?.length
            ? { allowed_file_types: field.allowed_file_types }
            : {}),
          ...(field.max_file_size_mb ? { max_file_size_mb: field.max_file_size_mb } : {}),
          ...(field.shareable_with_sponsors ? { shareable_with_sponsors: true } : {}),
          ...(field.profile_cv ? { profile_cv: true } : {}),
        }
      : {}),
    ...(field.project_description && (field.kind === "text" || field.kind === "textarea")
      ? { project_description: true }
      : {}),
    ...(field.project_video && field.kind === "text" ? { project_video: true } : {}),
    ...(field.judging_link && field.kind === "text" ? { judging_link: true } : {}),
    ...(field.section_key ? { section_key: field.section_key } : {}),
    ...(field.after_section_key ? { after_section_key: field.after_section_key } : {}),
    ...(hasI18nText(field.help_text) ? { help_text: field.help_text } : {}),
    ...(hasI18nText(field.placeholder) ? { placeholder: field.placeholder } : {}),
    ...(field.validation && VALIDATABLE_KINDS.has(field.kind)
      ? { validation: field.validation }
      : {}),
    retention_mode: field.retention_mode ?? "none",
    ...(field.retention_mode === "anonymous_audit" && field.anonymous_audit_dimension
      ? { anonymous_audit_dimension: field.anonymous_audit_dimension.trim() }
      : {}),
    ...(field.statistics ? { statistics: field.statistics } : {}),
  };
}
