"use client";
import { useEffect, useState } from "react";
import type { PublicEvent } from "@/components/public/public-types";
import { usePublishedWinners } from "@/hooks/use-published-winners";
import { useLocale } from "@/lib/i18n";
import { MarqueeText } from "./marquee-text";
import { TvBody, TvHeader, TvScreen } from "./tv-screen";

/** H60: reveal content on the existing live mode; no extra manual TV mode. */
export function PublishedWinners({
  event,
  children,
}: {
  event: PublicEvent;
  children: React.ReactNode;
}) {
  const winners = usePublishedWinners("/api/tv/winners");
  const { t, language } = useLocale();
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setPage((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);
  if (!winners.length) return children;
  const count = 4;
  const pages = Math.ceil(winners.length / count);
  const visible = winners.slice((page % pages) * count, ((page % pages) + 1) * count);
  return (
    <TvScreen>
      <TvHeader eventName={event.name} />
      <TvBody>
        <h1 className="mb-[1em] text-[2em] font-semibold text-balance">{t("winnersTabLabel")}</h1>
        <ol className="grid min-h-0 flex-1 gap-[1em]">
          {visible.map((winner) => (
            <li
              className="flex min-w-0 items-center gap-[1em] border-b py-[0.5em]"
              key={`${winner.challengeId}-${winner.rank}`}
            >
              <span className="text-[2em] tabular-nums">{winner.rank}</span>
              <div className="min-w-0 flex-1">
                <MarqueeText
                  className="text-[1.25em] text-muted-foreground"
                  text={
                    typeof winner.challengeTitle === "string"
                      ? winner.challengeTitle
                      : winner.challengeTitle[language]
                  }
                />
                <MarqueeText className="text-[2em] font-semibold" text={winner.repoName} />
              </div>
            </li>
          ))}
        </ol>
      </TvBody>
    </TvScreen>
  );
}
