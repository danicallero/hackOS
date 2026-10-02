"use client";

import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { useTheme } from "next-themes";
import { IconButton } from "@/components/common/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/lib/i18n";

/** Light / dark / system theme switcher. Light is the default. */
export function ThemeToggle() {
  const { setTheme } = useTheme();
  const { t } = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="ghost" size="icon-sm" label={t("toggleTheme")}>
          <SunIcon
            aria-hidden="true"
            className="size-4 scale-100 rotate-0 transition-[opacity,transform] dark:scale-0 dark:-rotate-90"
          />
          <MoonIcon
            aria-hidden="true"
            className="absolute size-4 scale-0 rotate-90 transition-[opacity,transform] dark:scale-100 dark:rotate-0"
          />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <SunIcon aria-hidden="true" className="size-4" /> {t("light")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <MoonIcon aria-hidden="true" className="size-4" /> {t("dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <MonitorIcon aria-hidden="true" className="size-4" /> {t("system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
