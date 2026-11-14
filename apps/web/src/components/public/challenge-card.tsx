"use client";

import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import Link from "next/link";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { displayText, type PublicChallenge } from "./public-types";

/**
 * One challenge as a single tap target: the company mark, the title, a short
 * excerpt and, when there are prizes, a trophy line (H45, H47). No footer
 * button: the whole card is the link.
 */
export function ChallengeCard({ challenge }: { challenge: PublicChallenge }) {
  const { t, language } = useLocale();
  const title = displayText(challenge.title, language);
  const hasPrizes = Array.isArray(challenge.prizes) && challenge.prizes.length > 0;
  return (
    <Link
      href={`/challenge/${challenge.id}`}
      className="button-interaction group flex h-full flex-col gap-3 rounded-surface border border-border/60 bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5 ring-1 ring-border/60 dark:bg-card">
          {challenge.enterprise.logoUrl ? (
            <SponsorLogo
              logoUrl={challenge.enterprise.logoUrl}
              logoNegativeUrl={challenge.enterprise.logoNegativeUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs font-semibold text-muted-foreground">
              {initials(challenge.enterprise.name)}
            </span>
          )}
        </span>
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {challenge.enterprise.name}
        </span>
      </span>
      <span className="space-y-1">
        <span className="block font-display text-xl leading-snug text-balance">{title}</span>
        <span className="line-clamp-3 block text-sm text-muted-foreground text-pretty">
          {displayText(challenge.description, language)}
        </span>
      </span>
      {hasPrizes && (
        <span className="mt-auto flex items-center gap-1.5 pt-1 text-sm font-medium text-primary">
          <TrophyIcon aria-hidden="true" weight="fill" className="size-4" />
          {t("prizesAvailable")}
        </span>
      )}
    </Link>
  );
}
