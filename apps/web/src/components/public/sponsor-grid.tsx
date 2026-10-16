import { SponsorLogo } from "@/components/common/sponsor-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PublicSponsor } from "./public-types";

/** H45: enterprise priority is ascending (1 is primary), shared by both event surfaces. */
export function SponsorGrid({
  sponsors,
  className,
}: {
  sponsors: PublicSponsor[];
  className?: string;
}) {
  const ordered = [...sponsors].sort(
    (a, b) => (a.priority ?? 9999) - (b.priority ?? 9999) || a.name.localeCompare(b.name),
  );
  return (
    <ul className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4", className)}>
      {ordered.map((sponsor) => {
        const mark = sponsor.logoUrl ? (
          <SponsorLogo
            logoUrl={sponsor.logoUrl}
            logoNegativeUrl={sponsor.logoNegativeUrl}
            alt={sponsor.name}
            className="max-h-16 max-w-full object-contain"
          />
        ) : (
          <span className="whitespace-normal font-medium">{sponsor.name}</span>
        );
        return (
          <li key={sponsor.enterpriseId}>
            {sponsor.website ? (
              <Button asChild variant="ghost" className="h-32 w-full rounded-surface p-6">
                <a
                  href={sponsor.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={sponsor.name}
                >
                  {mark}
                </a>
              </Button>
            ) : (
              <div className="flex h-32 items-center justify-center p-6 text-center">{mark}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
