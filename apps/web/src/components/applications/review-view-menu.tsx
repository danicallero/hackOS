"use client";

// H13: which answers the review modal shows by default. The form carries a
// standard view for every reviewer; each reviewer can override it locally.
// "View all" and editing always reveal every answer.

import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FormSection, TemplateField } from "@/lib/applications";
import { pickText, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";

interface ReviewViewGroup {
  section: FormSection | null;
  fields: TemplateField[];
}

/** Hidden answer keys: the reviewer's own choice when set, else the form's standard view. */
export function useReviewView(applicationId: number, standardHidden: string[]) {
  const storageKey = `review-view:${applicationId}`;
  const [personal, setPersonal] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      setPersonal(raw ? (JSON.parse(raw) as string[]) : null);
    } catch {
      setPersonal(null);
    }
  }, [storageKey]);
  const hidden = useMemo(() => new Set(personal ?? standardHidden), [personal, standardHidden]);
  const setHidden = useCallback(
    (next: string[] | null) => {
      setPersonal(next);
      try {
        if (next) window.localStorage.setItem(storageKey, JSON.stringify(next));
        else window.localStorage.removeItem(storageKey);
      } catch {
        // storage unavailable: the choice just won't persist
      }
    },
    [storageKey],
  );
  return { hidden, customized: personal !== null, setHidden };
}

export function ReviewViewMenu({
  groups,
  hidden,
  customized,
  lang,
  onChange,
  onSaveStandard,
  savingStandard,
}: {
  groups: ReviewViewGroup[];
  hidden: Set<string>;
  customized: boolean;
  lang: Language;
  /** Replaces this reviewer's hidden set; null returns to the standard view. */
  onChange: (next: string[] | null) => void;
  /** Present only for reviewers who may change the form's standard view. */
  onSaveStandard?: (hidden: string[]) => void;
  savingStandard?: boolean;
}) {
  const { t } = useLocale();
  const toggle = (key: string, show: boolean) => {
    const next = new Set(hidden);
    if (show) next.delete(key);
    else next.add(key);
    onChange([...next]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          label={t("customizeReviewView")}
        >
          <SlidersHorizontalIcon aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70dvh] w-80 space-y-4 overflow-y-auto">
        {groups.map((group, index) => (
          <fieldset key={group.section?.key ?? `ungrouped-${index}`} className="space-y-1">
            {group.section && (
              <legend className="type-section-title mb-1">
                {pickText(group.section.title, lang)}
              </legend>
            )}
            {group.fields.map((field) => {
              const id = `review-view-${field.key}`;
              return (
                <div key={field.key} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={!hidden.has(field.key)}
                    onCheckedChange={(checked) => toggle(field.key, checked === true)}
                  />
                  <Label htmlFor={id} className="min-w-0 flex-1 font-normal">
                    {pickText(field.label, lang) || field.key}
                  </Label>
                </div>
              );
            })}
          </fieldset>
        ))}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          {customized && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
              {t("resetReviewView")}
            </Button>
          )}
          {onSaveStandard && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={savingStandard}
              onClick={() => onSaveStandard([...hidden])}
            >
              {t("saveStandardReviewView")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
