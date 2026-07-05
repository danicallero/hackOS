import { ArrowDownRightIcon, ArrowUpRightIcon, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Metric tile: label + big value + optional hint, icon, and delta. One
 * component for every KPI in the app (dashboards, panels). Everything but the
 * value is optional and prop-driven.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
  footer,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  /** Signed change, e.g. { value: "+12%", direction: "up" }. */
  delta?: { value: string; direction: "up" | "down" };
  /** Slot under the value — e.g. a <UsageMeter> or sparkline. */
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-sm font-medium">{label}</span>
        {Icon && <Icon className="text-muted-foreground size-4 shrink-0" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              delta.direction === "up" ? "text-success" : "text-destructive",
            )}
          >
            {delta.direction === "up" ? (
              <ArrowUpRightIcon className="size-3" />
            ) : (
              <ArrowDownRightIcon className="size-3" />
            )}
            {delta.value}
          </span>
        )}
      </div>
      {hint && <p className="text-muted-foreground mt-1 truncate text-xs">{hint}</p>}
      {footer && <div className="mt-3">{footer}</div>}
    </Card>
  );
}
