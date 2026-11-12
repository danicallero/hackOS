"use client";

import { LiveScreen } from "@/app/(public)/tv/live-screen";
import { EmptyState } from "@/components/common/empty-state";
import type { PublicEvent, PublicSponsor } from "@/components/public/public-types";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi } from "@/lib/logistics";
import { getTvVenueConfig, type LiveScreenConfig } from "@/lib/tv";

/**
 * DESIGN.md §6 names "TV mode" directly as a case needing a live preview
 * beside its configuration. This renders the real kiosk component (`LiveScreen`,
 * `fill`-sized instead of viewport-sized) against the draft config an operator
 * is editing — not the actually-broadcast state, which the "Current broadcast"
 * mirror above already covers.
 */

export function LiveModePreview({ config }: { config: LiveScreenConfig }) {
  const { t } = useLocale();
  const { data, error } = useServerResource(["tv", "draft-preview"], async (signal) => {
    const [event, schedule, sponsorResult, venue] = await Promise.all([
      api.get<PublicEvent>("/api/public/event", { signal }),
      logisticsApi.publicSchedule(),
      api.get<{ items: PublicSponsor[] }>("/api/public/sponsors?kind=sponsor", { signal }),
      getTvVenueConfig(),
    ]);
    return { event, schedule: schedule.items, sponsors: sponsorResult.items, venue };
  });

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
        ) : error ? (
          <EmptyState className="h-full" title={t("draftPreviewUnavailable")} />
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}
      </div>
      <p className="text-muted-foreground text-sm">{t("draftPreviewHint")}</p>
    </div>
  );
}
