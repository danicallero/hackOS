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

/** A compact language control for routes without a profile form. */
export function LanguageSelect() {
  const { language, setLanguage, t } = useLocale();
  return (
    <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
      <SelectTrigger className="h-8 w-28" aria-label={t("languageLabel")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(["es", "gl", "en"] as const).map((item) => (
          <SelectItem key={item} value={item}>
            {languageName(item)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
