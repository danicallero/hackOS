"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { languageName, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A compact language control for routes without the authenticated account menu. */
export function LanguageSelect({ className }: { className?: string }) {
  const { language, setLanguage, t } = useLocale();
  return (
    <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
      <SelectTrigger size="sm" className={cn("w-18 px-2.5", className)} aria-label={t("language")}>
        <SelectValue>{language.toUpperCase()}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {(["es", "gl", "en"] as const).map((item) => (
          <SelectItem key={item} value={item}>
            {languageName(item)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
