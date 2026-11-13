import { heroGradient } from "@/lib/company";
import { cn } from "@/lib/utils";

/**
 * Tinted page top that runs edge to edge and under the top of the canvas, with
 * no card around it (H47, H48). Place it as the page's first child, outside
 * `PageLayout`; it cancels the shell's padding. The wash comes from the
 * image colour and falls back to blue, as on mobile.
 */
export function HeroBleed({
  color,
  className,
  children,
}: {
  color: string | null | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-hero-bleed=""
      className={cn(
        "-mx-4 -mt-3 mb-6 px-4 pt-16 pb-10 [--hero-mix:60%] sm:-mx-6 sm:px-6 md:-mt-6 md:pt-10 lg:-mt-8 dark:[--hero-mix:40%]",
        className,
      )}
    >
      {/* Fixed, so the wash reaches the window edges and runs behind the sidebar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[28rem]"
        style={{ backgroundImage: heroGradient(color) }}
      />
      <div className="relative mx-auto w-full max-w-(--page-width-reading)">{children}</div>
    </div>
  );
}
