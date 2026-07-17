import type { LucideIcon } from "lucide-react";
import { useId } from "react";
import { Section } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/**
 * Semantic, border-only domain section with an optional state, action, or
 * exceptional description. It intentionally has no inline elevation.
 */
export function SectionCard({
  title,
  description,
  icon: Icon,
  state,
  action,
  footer,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  state?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const titleId = useId();

  return (
    <Section padding="none" aria-labelledby={titleId} className={cn("overflow-hidden", className)}>
      <div className="flex flex-col gap-[var(--space-within-section)] p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          {Icon && <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" />}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-[var(--space-related)]">
              <h2 id={titleId} className="type-section-title text-balance">
                {title}
              </h2>
              {state && <div className="shrink-0">{state}</div>}
            </div>
            {description && (
              <p className="text-muted-foreground text-pretty text-sm">{description}</p>
            )}
          </div>
        </div>
        {action && (
          <div className="flex flex-wrap items-center gap-[var(--space-related)] sm:shrink-0">
            {action}
          </div>
        )}
      </div>
      <div className="border-border border-t" />
      <div className={cn("space-y-[var(--space-within-section)] p-4 sm:p-5", bodyClassName)}>
        {children}
      </div>
      {footer && (
        <div className="flex flex-wrap justify-end gap-2 px-4 pb-4 sm:px-5 sm:pb-5">{footer}</div>
      )}
    </Section>
  );
}
