"use client";

import { useCallback, useState } from "react";
import { templateFieldId } from "@/components/common/template-field-control";
import { validateFieldOnBlur } from "@/lib/application-validation";
import type { Translate } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import type { TemplateField } from "../lib";

interface Options {
  applicationId: number;
  template: TemplateField[];
  values: Record<string, unknown>;
  t: Translate;
  language: Language;
}

export function useApplicationFieldValidation({
  applicationId,
  template,
  values,
  t,
  language,
}: Options) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateOnBlur = useCallback(
    (field: TemplateField, value: unknown = values[field.key]) => {
      const message = validateFieldOnBlur(field, value, t, language);
      setFieldErrors((current) => {
        const next = { ...current };
        if (message) next[field.key] = message;
        else delete next[field.key];
        return next;
      });
    },
    [language, t, values],
  );

  const validateFields = useCallback(() => {
    const errors: Record<string, string> = {};
    for (const field of template) {
      const message = validateFieldOnBlur(field, values[field.key], t, language);
      if (message) errors[field.key] = message;
    }
    setFieldErrors(errors);
    const firstInvalid = template.find((field) => errors[field.key]);
    if (firstInvalid) {
      requestAnimationFrame(() => {
        document.getElementById(templateFieldId(firstInvalid.key, applicationId))?.focus();
      });
    }
    return Object.keys(errors).length === 0;
  }, [applicationId, language, t, template, values]);

  return { validateFields, fieldErrors, setFieldErrors, validateOnBlur };
}
