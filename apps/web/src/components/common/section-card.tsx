import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { useId } from "react";
import { ActionGroup } from "@/components/common/action-group";
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
  leading,
  state,
  action,
  footer,
  headerClassName,
  footerClassName,
  stickyFooter = false,
  className,
  bodyClassName,
  variant = "surface",
  children,
}: {
  /**
   * Omit when the surrounding chrome already names this section (e.g. a tab
   * whose label already says what the panel below it is) — pass only
   * `description` in that case, per the no-repeated-headings rule (H8).
   */
  title?: React.ReactNode;
  /** Exceptional policy/risk copy only — see the header's own writing rules. */
  description?: string;
  icon?: PhosphorIcon;
  /** Visual identity for the section header, in the same slot as `icon`. */
  leading?: React.ReactNode;
  /** Status indicator next to the title, e.g. a `<StatusBadge>`. */
  state?: React.ReactNode;
  /** Header-row controls, e.g. buttons; right-aligned next to the title/description. */
  action?: React.ReactNode;
  /** Right-aligned row below the body, separated by its own top border. */
  footer?: React.ReactNode;
  /** Additional classes for the header row. */
  headerClassName?: string;
  /** Additional classes for the footer row. */
  footerClassName?: string;
  /** Keep the save owner reachable while a long page form scrolls. */
  stickyFooter?: boolean;
  className?: string;
  /** className for the body wrapper specifically, separate from the section's own. */
  bodyClassName?: string;
  /** Open page section; hierarchy comes from spacing rather than a container. */
  variant?: "surface" | "plain";
  children: React.ReactNode;
}) {
  const titleId = useId();
  const hasHeaderText = title !== undefined || Boolean(description);

  return (
    <Section
      padding="none"
      aria-labelledby={title !== undefined ? titleId : undefined}
      className={cn(
        variant === "surface" ? "overflow-hidden" : "overflow-visible",
        variant === "plain" && "rounded-none border-0 bg-transparent text-foreground",
        className,
      )}
    >
      {(hasHeaderText || Icon || leading || state || action) && (
        <div
          className={cn(
            "flex flex-col gap-(--space-within-section) p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5",
            variant === "plain" &&
              "border-b border-border/60 p-0 pb-3 sm:items-center sm:p-0 sm:pb-3",
            headerClassName,
          )}
        >
          <div
            className={cn(
              "flex min-w-0 items-start gap-3",
              variant === "plain" && "min-h-(--control-height-compact) items-center",
            )}
          >
            {leading && <div className="shrink-0">{leading}</div>}
            {title === undefined && Icon && !leading && (
              <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 space-y-1">
              {title !== undefined && (
                <div className="heading-row flex flex-wrap items-center gap-(--space-related)">
                  {Icon && !leading && (
                    <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
                  )}
                  <h2 id={titleId} className="type-section-title wrap-break-word text-balance">
                    {title}
                  </h2>
                  {state && <div className="shrink-0">{state}</div>}
                </div>
              )}
              {title === undefined && state && <div>{state}</div>}
              {description && (
                <p className="text-muted-foreground wrap-break-word text-pretty text-sm">
                  {description}
                </p>
              )}
            </div>
          </div>
          {action && <ActionGroup className="sm:shrink-0">{action}</ActionGroup>}
        </div>
      )}
      {variant === "surface" && (hasHeaderText || Icon || leading || state || action) && (
        <div className="border-border border-t" />
      )}
      <div
        className={cn(
          "space-y-(--space-within-section)",
          variant === "plain" && "pt-4",
          variant === "surface" && "p-4 sm:p-5",
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer && (
        <ActionGroup
          data-surface={variant}
          className={cn(
            "justify-end",
            variant === "surface" ? "px-4 pb-4 sm:px-5 sm:pb-5" : "pt-4",
            stickyFooter && "form-action-footer",
            footerClassName,
          )}
        >
          {footer}
        </ActionGroup>
      )}
    </Section>
  );
}
