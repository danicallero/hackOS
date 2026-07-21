"use client";

import { useState } from "react";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import type { PublicSponsor } from "@/components/public/public-types";

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

  if (!sponsor.logoUrl || failed) {
    return (
      <span className="text-center text-[1.1em] font-semibold break-words hyphens-auto">
        {sponsor.name}
      </span>
    );
  }
  return (
    <SponsorLogo
      logoUrl={sponsor.logoUrl}
      logoNegativeUrl={sponsor.logoNegativeUrl}
      alt={sponsor.name}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
