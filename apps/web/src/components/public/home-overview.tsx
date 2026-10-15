"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ClockCountdownIcon } from "@phosphor-icons/react/dist/csr/ClockCountdown";
import { MegaphoneIcon } from "@phosphor-icons/react/dist/csr/Megaphone";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import Link from "next/link";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { SponsorGrid } from "@/components/public/sponsor-grid";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import type {
  PublicAnnouncement,
  PublicChallenge,
  PublicEvent,
  PublicSponsor,
} from "./public-types";
import { displayText } from "./public-types";
import { EventPhaseDisplay, useEventPhase } from "./timer";

/** H41/H45/H47: the event overview owns event information; programme and inbox keep their own views. */
export function HomeOverview({
  event,
  screenAnnouncements,
  challenges,
  sponsors,
}: {
  event: PublicEvent;
  screenAnnouncements: PublicAnnouncement[];
  challenges: PublicChallenge[];
  sponsors: PublicSponsor[];
}) {
  const { t, language } = useLocale();
  const phase = useEventPhase(event);
  return (
    <div className="space-y-8">
      {phase.kind !== "none" && (
        <section className="flex items-start gap-4 py-2" aria-label={phase.label}>
          <ClockCountdownIcon
            aria-hidden="true"
            className="mt-1 size-6 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0">
            <EventPhaseDisplay
              phase={phase}
              labelClassName="type-section-title"
              className="mt-4 block font-mono text-4xl font-semibold tabular-nums sm:text-6xl"
            />
          </div>
        </section>
      )}
      {screenAnnouncements.length > 0 && (
        <SectionCard variant="plain" title={t("publicAnnouncements")} icon={MegaphoneIcon}>
          <div className="grid gap-4 md:grid-cols-2">
            {screenAnnouncements.map((item) => (
              <article key={item.id} className="border-l-2 border-primary bg-primary/5 px-4 py-3">
                <h3 className="font-medium">{item.title}</h3>
                <p className="mt-1 whitespace-pre-wrap text-pretty text-sm text-muted-foreground">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </SectionCard>
      )}
      <SectionCard variant="plain" title={t("challengesAndPrizes")} icon={TrophyIcon}>
        {challenges.length ? (
          <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {challenges.map((challenge) => (
              <SectionCard
                key={challenge.id}
                title={displayText(challenge.title, language)}
                className="flex h-full flex-col"
                bodyClassName="flex-1"
                footer={
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/challenge/${challenge.id}`}
                      aria-label={`${t("viewChallenge")}: ${displayText(challenge.title, language)}`}
                    >
                      {t("viewChallenge")}
                      <ArrowRightIcon aria-hidden="true" />
                    </Link>
                  </Button>
                }
              >
                <p className="text-xs text-muted-foreground">{challenge.enterprise.name}</p>
                <p className="line-clamp-3 text-pretty text-sm">
                  {displayText(challenge.description, language)}
                </p>
              </SectionCard>
            ))}
          </div>
        ) : (
          <EmptyState icon={TrophyIcon} title={t("challengesPending")} />
        )}
      </SectionCard>
      <SectionCard variant="plain" title={t("sponsors")}>
        {sponsors.length ? (
          <SponsorGrid sponsors={sponsors} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("sponsorsPending")}</p>
        )}
      </SectionCard>
    </div>
  );
}
