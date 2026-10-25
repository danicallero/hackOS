"use client";

import { GlobeIcon } from "@phosphor-icons/react/dist/csr/Globe";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { languageName, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";

/** A compact language menu for routes without the authenticated account menu; pairs with `ThemeToggle`. */
export function LanguageSelect() {
  const { language, setLanguage, t } = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("language")}>
          <GlobeIcon aria-hidden="true" className="size-4" />
          <span className="max-sm:sr-only">{language.toUpperCase()}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(value) => setLanguage(value as Language)}
        >
          {(["es", "gl", "en"] as const).map((item) => (
            <DropdownMenuRadioItem key={item} value={item}>
              {languageName(item)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
