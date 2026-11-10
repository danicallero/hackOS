import { cn } from "@/lib/utils";

/**
 * A notice that opens the content canvas (verify email, finish onboarding).
 * It is an inline, bordered notice on the page's gutters, level with the
 * floating sidebar's top edge, and the page continues below it, instead of a
 * full-bleed strip glued to the viewport edge. The action sits at the trailing
 * edge; on narrow screens the notice is one compact row that leaves room for the
 * fixed sidebar control. While it is shown, `PageHeader` stops reserving that
 * room itself (`data-shell-notice`).
 */
export function ShellBanner({
  tone,
  icon,
  action,
  className,
  children,
}: {
  tone: "warning" | "info";
  icon: React.ReactNode;
  action: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-shell-notice className="px-4 pt-2 sm:px-6 max-md:pl-14">
      <div
        role="status"
        className={cn(
          "mx-auto flex w-full max-w-7xl items-center gap-2 rounded-frame border px-3 py-1.5 text-xs md:gap-3 md:px-4 md:py-2 md:text-sm",
          tone === "warning"
            ? "border-warning/40 bg-warning/10"
            : "border-primary/30 bg-primary/10",
          className,
        )}
      >
        {icon}
        <p className="text-foreground min-w-0 flex-1">{children}</p>
        <div className="shrink-0">{action}</div>
      </div>
    </div>
  );
}
