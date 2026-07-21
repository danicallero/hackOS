"use client";

import { ArrowLeftIcon, CalendarDaysIcon } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/common/brand";
import { LanguageSelect } from "@/components/common/language-select";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { PublicScheduleView } from "@/components/public/public-schedule-view";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

export default function PublicSchedulePage() {
  const { t } = useLocale();

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-16 sm:px-8">
      <header className="flex items-center justify-between gap-3 border-b py-5">
        <Brand />
        <div className="flex items-center gap-1">
          <LanguageSelect />
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              {t("back")}
            </Link>
          </Button>
        </div>
      </header>
      <div className="py-8 sm:py-12">
        <PublicScheduleView
          header={(event) => (
            <div className="mb-8 flex items-start gap-3">
              <div className="bg-primary/10 text-primary rounded-lg p-2.5">
                <CalendarDaysIcon className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-balance text-3xl font-semibold">{t("publicSchedule")}</h1>
                <p className="text-muted-foreground text-pretty mt-1 text-sm">
                  {event?.name ?? "hackOS"}
                </p>
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}
