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
      {/* biome-ignore lint/performance/noImgElement: External sponsor logo URL. */}
      <img
        src={logoUrl}
        alt={alt}
        className={cn(className, "dark:hidden")}
        onError={onError}
        onLoad={onLoad}
      />
      {/* biome-ignore lint/performance/noImgElement: External sponsor logo URL. */}
      <img
        src={negative}
        alt={alt}
        className={cn(className, "hidden dark:block")}
        onError={onError}
        onLoad={onLoad}
      />
    </>
  );
}
