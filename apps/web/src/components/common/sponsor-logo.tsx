import Image from "next/image";
import type { ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Renders the appropriate sponsor logo for the active colour scheme. */
export function SponsorLogo({
  logoUrl,
  logoNegativeUrl,
  alt,
  className,
  onError,
  onLoad,
}: {
  logoUrl: string;
  /** Dark-mode variant; falls back to `logoUrl` when unset. */
  logoNegativeUrl?: string | null;
  alt: string;
  className?: string;
  /** Fires when the image fails to load, so callers can fall back (see SponsorMark). */
  onError?: () => void;
  /** Lets display surfaces account for the source mark's intrinsic proportions. */
  onLoad?: ImgHTMLAttributes<HTMLImageElement>["onLoad"];
}) {
  const negative = logoNegativeUrl ?? logoUrl;

  return (
    <>
      {/* Sponsor URLs are user-entered external URLs (H44), so they cannot be safely allowlisted. */}
      <Image
        src={logoUrl}
        alt={alt}
        width={1}
        height={1}
        unoptimized
        className={cn("size-auto", className, "dark:hidden")}
        onError={onError}
        onLoad={onLoad}
      />
      <Image
        src={negative}
        alt={alt}
        width={1}
        height={1}
        unoptimized
        className={cn("size-auto", className, "hidden dark:block")}
        onError={onError}
        onLoad={onLoad}
      />
    </>
  );
}
