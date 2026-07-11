import { cn } from "@/lib/utils";

/** Renders the appropriate sponsor logo for the active colour scheme. */
export function SponsorLogo({
  logoUrl,
  logoNegativeUrl,
  alt,
  className,
}: {
  logoUrl: string;
  logoNegativeUrl?: string | null;
  alt: string;
  className?: string;
}) {
  const negative = logoNegativeUrl ?? logoUrl;

  return (
    <>
      {/* biome-ignore lint/performance/noImgElement: External sponsor logo URL. */}
      <img src={logoUrl} alt={alt} className={cn(className, "dark:hidden")} />
      {/* biome-ignore lint/performance/noImgElement: External sponsor logo URL. */}
      <img src={negative} alt={alt} className={cn(className, "hidden dark:block")} />
    </>
  );
}
