"use client";

import { ArrowLeftIcon, CalendarDaysIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/common/brand";
import { LanguageSelect } from "@/components/common/language-select";
import { Spinner } from "@/components/common/spinner";
import { ThemeToggle } from "@/components/common/theme-toggle";
import type { PublicEvent } from "@/components/public/public-types";
import { ScheduleTimeline } from "@/components/public/schedule-timeline";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";

export default function PublicSchedulePage() {
  const { t } = useLocale();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [items, setItems] = useState<PublicScheduleItem[] | null>(null);

  useEffect(() => {
    void Promise.all([
      api.get<PublicEvent>("/api/public/event"),
      logisticsApi.publicSchedule(),
    ]).then(([eventResult, scheduleResult]) => {
      setEvent(eventResult);
      setItems(scheduleResult.items);
    });
  }, []);

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
        {items === null || event === null ? (
          <div className="flex justify-center py-20" role="status" aria-busy="true">
            <Spinner className="size-6" />
            <span className="sr-only">{t("loading")}</span>
          </div>
        ) : (
          <ScheduleTimeline items={items} timezone={event.timezone} />
        )}
      </div>
    </div>
  );
}
