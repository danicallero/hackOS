import { heroGradient } from "@/lib/company";
import { cn } from "@/lib/utils";

/** Opaque to 60% of the hero, then fading into the page, as on mobile. */
const AMBIENT_MASK = "linear-gradient(to bottom, #000 60%, transparent 100%)";

/**
 * Tinted page top that runs edge to edge and under the top of the canvas, with
 * no card around it (H47, H48). Place it as the page's first child, outside
 * `PageLayout`; it cancels the shell's padding. The wash comes from the
 * image colour and falls back to blue, as on mobile. With `ambient` photos the
 * wash is the visible photo itself instead (H18, H48): enlarged and blurred
 * until no shape survives, under a veil of the page colour, fading into the
 * page, and cross-fading when the visible photo changes.
 */
export function HeroBleed({
  color,
  ambient,
  className,
  contentClassName,
  children,
}: {
  color: string | null | undefined;
  /** Image URLs the page already shows (same request, no extra download) and the visible one. */
  ambient?: { urls: string[]; active: string };
  className?: string;
  /** Overrides the reading-width cap of the content. */
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-hero-bleed=""
      className={cn(
        "-mx-4 -mt-3 mb-6 px-4 pt-6 pb-10 [--hero-mix:60%] sm:-mx-6 sm:px-6 md:-mt-6 md:pt-10 lg:-mt-8 dark:[--hero-mix:40%]",
        className,
      )}
    >
      {/* Fixed, so the wash reaches the window edges and runs behind the sidebar. */}
      {ambient?.urls.length ? (
        <div
          aria-hidden="true"
          data-hero-ambient=""
          className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[28rem] overflow-hidden"
          style={{ maskImage: AMBIENT_MASK, WebkitMaskImage: AMBIENT_MASK }}
        >
          {/* One blur over the stack: the cross-fade blends already-blurred colours. */}
          <div className="absolute inset-0 scale-[1.4] blur-[72px] saturate-[1.3]">
            {ambient.urls.map((url) => (
              // biome-ignore lint/performance/noImgElement: the same authenticated request the gallery makes.
              <img
                key={url}
                src={url}
                alt=""
                crossOrigin="use-credentials"
                data-active={url === ambient.active ? "true" : undefined}
                className={cn(
                  "absolute inset-0 size-full object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none",
                  url === ambient.active ? "opacity-100" : "opacity-0",
                )}
              />
            ))}
          </div>
          <div className="absolute inset-0 bg-background/35" />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[28rem]"
          style={{ backgroundImage: heroGradient(color) }}
        />
      )}
      <div className={cn("relative mx-auto w-full max-w-(--page-width-reading)", contentClassName)}>
        {children}
      </div>
    </div>
  );
}
