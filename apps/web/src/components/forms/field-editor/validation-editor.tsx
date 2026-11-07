"use client";

// Response-validation rule editor (H11).

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FieldValidation, TemplateField } from "@/lib/applications";
import { useLocale } from "@/lib/i18n";
import { EMPTY_I18N } from "@/lib/i18n-text";
import type { Language } from "@/lib/types";

/** Response-validation rule editor (H11) — length/pattern for text, min/max
 *  for number, selection count for multiselect, plus a custom error message. */
type TextValidationCategory = "text" | "length" | "regex";
type SelectCountCondition = "at_least" | "at_most" | "exactly";

export function ValidationEditor({
  field,
  primaryLocale,
  onChange,
}: {
  field: TemplateField;
  primaryLocale: Language;
  onChange: (patch: Partial<FieldValidation>) => void;
}) {
  const { t } = useLocale();
  const uid = useId();
  const v = field.validation ?? {};

  const numberField = (
    label: string,
    key: "min_length" | "max_length" | "min" | "max" | "min_age",
    extra?: Partial<FieldValidation>,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`validation-${uid}-${key}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`validation-${uid}-${key}`}
        type="number"
        value={v[key] ?? ""}
        onChange={(e) =>
          onChange({ [key]: e.target.value ? Number(e.target.value) : undefined, ...extra })
        }
        size="sm"
      />
    </div>
  );

  const errorMessageField = (
    <div className="space-y-1.5">
      <Label htmlFor={`validation-${uid}-error`} className="text-xs">
        {t("customErrorMessageLabel")}
      </Label>
      <Input
        id={`validation-${uid}-error`}
        value={v.error_message?.[primaryLocale] ?? ""}
        onChange={(e) =>
          onChange({
            error_message: { ...(v.error_message ?? EMPTY_I18N), [primaryLocale]: e.target.value },
          })
        }
        size="sm"
      />
    </div>
  );

  if (field.kind === "text" || field.kind === "textarea") {
    const category: TextValidationCategory = v.text_condition
      ? "text"
      : v.pattern !== undefined
        ? "regex"
        : "length";
    const setCategory = (next: TextValidationCategory) => {
      if (next === "text") {
        onChange({
          text_condition: "contains",
          text_value: "",
          pattern: undefined,
          min_length: undefined,
          max_length: undefined,
        });
      } else if (next === "regex") {
        onChange({
          pattern: v.pattern ?? "",
          text_condition: undefined,
          text_value: undefined,
          min_length: undefined,
          max_length: undefined,
        });
      } else {
        onChange({ text_condition: undefined, text_value: undefined, pattern: undefined });
      }
    };
    const needsTextValue = v.text_condition === "contains" || v.text_condition === "not_contains";

    return (
      <div className="space-y-3 border-t pt-4">
        <div className="space-y-1.5">
          <Label htmlFor={`validation-${uid}-category`} className="text-xs">
            {t("validationCategoryLabel")}
          </Label>
          <Select
            value={category}
            onValueChange={(val) => setCategory(val as TextValidationCategory)}
          >
            <SelectTrigger id={`validation-${uid}-category`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">{t("validationCategoryText")}</SelectItem>
              <SelectItem value="length">{t("validationCategoryLength")}</SelectItem>
              <SelectItem value="regex">{t("validationCategoryRegex")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {category === "text" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`validation-${uid}-condition`} className="text-xs">
                {t("conditionLabel")}
              </Label>
              <Select
                value={v.text_condition ?? "contains"}
                onValueChange={(cond) =>
                  onChange({
                    text_condition: cond as FieldValidation["text_condition"],
                    text_value:
                      cond === "contains" || cond === "not_contains"
                        ? (v.text_value ?? "")
                        : undefined,
                  })
                }
              >
                <SelectTrigger id={`validation-${uid}-condition`} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">{t("conditionContains")}</SelectItem>
                  <SelectItem value="not_contains">{t("conditionNotContains")}</SelectItem>
                  <SelectItem value="email">{t("conditionEmail")}</SelectItem>
                  <SelectItem value="url">{t("conditionUrl")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {needsTextValue && (
              <div className="space-y-1.5">
                <Label htmlFor={`validation-${uid}-text-value`} className="text-xs">
                  {t("valueLabel")}
                </Label>
                <Input
                  id={`validation-${uid}-text-value`}
                  value={v.text_value ?? ""}
                  onChange={(e) => onChange({ text_value: e.target.value })}
                  size="sm"
                />
              </div>
            )}
          </div>
        )}

        {category === "length" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {numberField(t("minLengthLabel"), "min_length")}
            {numberField(t("maxLengthLabel"), "max_length")}
          </div>
        )}

        {category === "regex" && (
          <div className="space-y-1.5">
            <Label htmlFor={`validation-${uid}-pattern`} className="text-xs">
              {t("patternLabel")}
            </Label>
            <Input
              id={`validation-${uid}-pattern`}
              value={v.pattern ?? ""}
              onChange={(e) => onChange({ pattern: e.target.value })}
              size="sm"
            />
          </div>
        )}

        {errorMessageField}
      </div>
    );
  }

  if (field.kind === "multiselect") {
    const condition: SelectCountCondition =
      v.min_selected !== undefined && v.min_selected === v.max_selected
        ? "exactly"
        : v.max_selected !== undefined
          ? "at_most"
          : "at_least";
    const count = condition === "at_most" ? v.max_selected : v.min_selected;
    const setCondition = (next: SelectCountCondition, n: number | undefined) => {
      if (next === "at_least") onChange({ min_selected: n, max_selected: undefined });
      else if (next === "at_most") onChange({ min_selected: undefined, max_selected: n });
      else onChange({ min_selected: n, max_selected: n });
    };

    return (
      <div className="space-y-3 border-t pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`validation-${uid}-select-condition`} className="text-xs">
              {t("selectConditionLabel")}
            </Label>
            <Select
              value={condition}
              onValueChange={(c) => setCondition(c as SelectCountCondition, count)}
            >
              <SelectTrigger id={`validation-${uid}-select-condition`} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="at_least">{t("selectAtLeast")}</SelectItem>
                <SelectItem value="at_most">{t("selectAtMost")}</SelectItem>
                <SelectItem value="exactly">{t("selectExactly")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`validation-${uid}-count`} className="text-xs">
              {t("countLabel")}
            </Label>
            <Input
              id={`validation-${uid}-count`}
              type="number"
              size="sm"
              value={count ?? ""}
              onChange={(e) =>
                setCondition(condition, e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
        </div>
        {errorMessageField}
      </div>
    );
  }

  if (field.kind === "birth_year") {
    return (
      <div className="space-y-3 border-t pt-4">
        {numberField(t("minAgeLabel"), "min_age")}
        {errorMessageField}
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="grid grid-cols-2 gap-3">
        {numberField(t("minValueLabel"), "min")}
        {numberField(t("maxValueLabel"), "max")}
      </div>
      {errorMessageField}
    </div>
  );
}
