import { cn } from "@/lib/utils";

/**
 * A notice that opens the content canvas (verify email, finish onboarding).
 * It is an inline, bordered notice on the page's gutters, level with the
 * floating sidebar's top edge, and the page continues below it, instead of a
 * full-bleed strip glued to the viewport edge. On narrow screens it leaves room
 * for the fixed sidebar control.
 */
export function ShellBanner({
  tone,
  className,
  children,
}: {
  tone: "warning" | "info";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pt-2 sm:px-6 max-md:pl-14">
      <div
        role="status"
        className={cn(
          "mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 rounded-frame border px-4 py-2 text-sm",
          tone === "warning"
            ? "border-warning/40 bg-warning/10"
            : "border-primary/30 bg-primary/10",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
