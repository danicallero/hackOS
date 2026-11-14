import Image from "next/image";
import { type ImgHTMLAttributes, useState } from "react";
import { useLogoBleed } from "@/lib/company";
import { cn } from "@/lib/utils";

/**
 * Renders the appropriate sponsor logo for the active colour scheme. Artwork
 * that runs into its own edges (no built-in margin) is drawn slightly smaller,
 * so it never touches its tile or slot (H44).
 */
export function SponsorLogo({
  logoUrl,
  logoNegativeUrl,
  alt,
  className,
  onError,
  onLoad,
  inset = true,
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
  /** Add the missing margin; off for text-sized inline marks that sit on no tile. */
  inset?: boolean;
}) {
  // A dark-mode variant that fails to load falls back to the normal logo.
  const [negativeBroken, setNegativeBroken] = useState(false);
  const negative = negativeBroken ? logoUrl : (logoNegativeUrl ?? logoUrl);
  const positiveBleeds = useLogoBleed(inset ? logoUrl : null);
  const negativeBleeds = useLogoBleed(inset ? negative : null);

  return (
    <>
      {/* Sponsor URLs are user-entered external URLs (H44), so they cannot be safely allowlisted. */}
      <Image
        src={logoUrl}
        alt={alt}
        width={1}
        height={1}
        unoptimized
        className={cn("size-auto", className, positiveBleeds && "scale-[0.82]", "dark:hidden")}
        onError={onError}
        onLoad={onLoad}
      />
      <Image
        src={negative}
        alt={alt}
        width={1}
        height={1}
        unoptimized
        className={cn(
          "size-auto",
          className,
          negativeBleeds && "scale-[0.82]",
          "hidden dark:block",
        )}
        onError={() => {
          if (negative !== logoUrl) setNegativeBroken(true);
          else onError?.();
        }}
        onLoad={onLoad}
      />
    </>
  );
}
