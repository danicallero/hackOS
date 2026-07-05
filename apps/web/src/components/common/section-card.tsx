import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Dokploy-style section card: a bordered card with a header (icon + title +
 * description, optional right-aligned action), a divider, a body, and an
 * optional footer (e.g. a Save button, right-aligned). This is THE container
 * for settings/detail sections — use it everywhere so every card looks the
 * same. Fields inside should be single-column and full-width (see the profile
 * page) so labels and inputs always line up.
 */
export function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  footer,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div className="flex items-start gap-3">
          {Icon && <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" />}
          <div className="space-y-1">
            <h2 className="text-lg leading-none font-semibold tracking-tight">{title}</h2>
            {description && <p className="text-muted-foreground text-sm">{description}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className="border-border border-t" />
      <div className={cn("space-y-5 px-6 py-6", bodyClassName)}>{children}</div>
      {footer && <div className="flex justify-end gap-2 px-6 pb-6">{footer}</div>}
    </Card>
  );
}
