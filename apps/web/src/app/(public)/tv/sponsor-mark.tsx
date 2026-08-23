"use client";

import { useState } from "react";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import type { PublicSponsor } from "@/components/public/public-types";
import { cn } from "@/lib/utils";

/** Sponsor files are commonly exported with a small transparent vertical pad. */
const SQUARE_ASPECT_TOLERANCE = 0.12;

function isSquareMark(width: number, height: number) {
  return Math.abs(width / height - 1) <= SQUARE_ASPECT_TOLERANCE;
}

/**
 * A sponsor's mark on a venue screen, with the one thing an unattended kiosk
 * needs that an admin page doesn't: if the logo fails to load — a dead URL, a
 * venue with no uplink, a sponsor who changed their CDN — the screen shows the
 * name instead of a broken-image icon on the wall for the rest of the event.
 */
export function SponsorMark({
  sponsor,
  className,
}: {
  sponsor: PublicSponsor;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [isSquare, setIsSquare] = useState(false);

  if (!sponsor.logoUrl || failed) {
    return (
      <span className="text-center text-[1.1em] font-semibold wrap-break-word hyphens-auto">
        {sponsor.name}
      </span>
    );
  }
  return (
    <SponsorLogo
      logoUrl={sponsor.logoUrl}
      logoNegativeUrl={sponsor.logoNegativeUrl}
      alt={sponsor.name}
      className={cn(className, isSquare && "scale-75")}
      onError={() => setFailed(true)}
      onLoad={(event) => {
        const { naturalHeight, naturalWidth } = event.currentTarget;
        setIsSquare(isSquareMark(naturalWidth, naturalHeight));
      }}
    />
  );
}
