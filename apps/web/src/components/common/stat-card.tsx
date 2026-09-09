import { ArrowDownRightIcon, ArrowUpRightIcon, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatTone = "neutral" | "success" | "danger" | "warning" | "info";

export const statToneSurfaceClass: Record<StatTone, string> = {
  neutral: "",
  success: "border-success/30 bg-success/5",
  danger: "border-destructive/30 bg-destructive/5",
  warning: "border-warning/30 bg-warning/5",
  info: "border-info/30 bg-info/5",
};

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
  action,
  tone = "neutral",
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
  /** Optional compact control displayed beside the metric icon. */
  action?: React.ReactNode;
  /** Semantic emphasis for dashboards; labels/icons must still communicate meaning. */
  tone?: StatTone;
  className?: string;
}) {
  const accentClass = {
    neutral: "text-foreground",
    success: "text-success",
    danger: "text-destructive",
    warning: "text-warning-foreground",
    info: "text-info",
  }[tone];
  return (
    <Card className={cn("gap-0 p-5", statToneSurfaceClass[tone], className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-sm font-medium">{label}</span>
        <span className="flex shrink-0 items-center gap-1">
          {Icon && <Icon className={cn("size-4 shrink-0", accentClass)} aria-hidden="true" />}
          {action}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums", accentClass)}>{value}</span>
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
      {hint && (
        <p className="text-muted-foreground mt-1 wrap-break-word text-pretty text-xs">{hint}</p>
      )}
      {footer && <div className="mt-3">{footer}</div>}
    </Card>
  );
}
