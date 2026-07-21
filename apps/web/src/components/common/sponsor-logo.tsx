import { cn } from "@/lib/utils";

/** Renders the appropriate sponsor logo for the active colour scheme. */
export function SponsorLogo({
  logoUrl,
  logoNegativeUrl,
  alt,
  className,
  onError,
}: {
  logoUrl: string;
  logoNegativeUrl?: string | null;
  alt: string;
  className?: string;
  /** Fires when the image fails to load, so callers can fall back (see SponsorMark). */
  onError?: () => void;
}) {
  const negative = logoNegativeUrl ?? logoUrl;

  return (
    <>
      {/* biome-ignore lint/performance/noImgElement: External sponsor logo URL. */}
      <img src={logoUrl} alt={alt} className={cn(className, "dark:hidden")} onError={onError} />
      {/* biome-ignore lint/performance/noImgElement: External sponsor logo URL. */}
      <img
        src={negative}
        alt={alt}
        className={cn(className, "hidden dark:block")}
        onError={onError}
      />
    </>
  );
}
