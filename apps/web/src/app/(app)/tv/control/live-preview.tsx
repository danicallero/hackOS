"use client";

import { useEffect, useState } from "react";
import { LiveScreen } from "@/app/(public)/tv/live-screen";
import type { PublicEvent, PublicSponsor } from "@/components/public/public-types";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";
import { getTvVenueConfig, type LiveScreenConfig, type TvVenueConfig } from "@/lib/tv";

/**
 * DESIGN.md §6 names "TV mode" directly as a case needing a live preview
 * beside its configuration. This renders the real kiosk component (`LiveScreen`,
 * `fill`-sized instead of viewport-sized) against the draft config an operator
 * is editing — not the actually-broadcast state, which the "Current broadcast"
 * mirror above already covers.
 */

interface PreviewData {
  event: PublicEvent;
  schedule: PublicScheduleItem[];
  sponsors: PublicSponsor[];
  venue: TvVenueConfig | null;
}

export function LiveModePreview({ config }: { config: LiveScreenConfig }) {
  const { t } = useLocale();
  const [data, setData] = useState<PreviewData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [event, schedule, sponsorResult, venue] = await Promise.all([
          api.get<PublicEvent>("/api/public/event"),
          logisticsApi.publicSchedule(),
          api.get<{ items: PublicSponsor[] }>("/api/public/sponsors"),
          getTvVenueConfig(),
        ]);
        if (cancelled) return;
        setData({ event, schedule: schedule.items, sponsors: sponsorResult.items, venue });
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t("draftPreviewLabel")}</span>
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black">
        {data ? (
          <div className="pointer-events-none h-full w-full">
            <LiveScreen
              config={config}
              event={data.event}
              schedule={data.schedule}
              sponsors={data.sponsors}
              venue={data.venue}
              fill
            />
          </div>
        ) : failed ? (
          <div className="text-muted-foreground flex h-full w-full items-center justify-center p-4 text-center text-sm">
            {t("draftPreviewUnavailable")}
          </div>
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}
      </div>
      <p className="text-muted-foreground text-sm">{t("draftPreviewHint")}</p>
    </div>
  );
}
