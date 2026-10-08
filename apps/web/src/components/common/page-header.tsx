import { ActionGroup } from "@/components/common/action-group";
import { cn } from "@/lib/utils";

/**
 * Title-first page hierarchy for authenticated screens. Descriptions are for
 * exceptional policy or risk copy; actions expose their priority explicitly.
 */
export function PageHeader({
  context,
  leading,
  title,
  state,
  meta,
  description,
  primaryAction,
  secondaryActions,
  actions,
  className,
  headingLevel = 1,
}: {
  context?: React.ReactNode;
  /** Visual identity for record pages (an avatar, a logo). Never an action. */
  leading?: React.ReactNode;
  title: string;
  /** Embedded design specimens use h2; destinations always keep the default h1. */
  headingLevel?: 1 | 2;
  state?: React.ReactNode;
  /** Identity metadata under the title (email, badge id) — not a description. */
  meta?: React.ReactNode;
  description?: string;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  /** @deprecated Prefer primaryAction and secondaryActions to make priority explicit. */
  actions?: React.ReactNode;
  className?: string;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const actionContent =
    primaryAction || secondaryActions ? (
      <>
        {secondaryActions}
        {primaryAction}
      </>
    ) : (
      actions
    );

  return (
    <header
      className={cn(
        "flex flex-col gap-(--space-within-section) md:flex-row md:items-start md:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-(--space-related) pl-12 md:pl-0">
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0 space-y-1">
          {context && <div className="type-meta">{context}</div>}
          <div className="heading-row min-h-(--line-height-page-title) flex flex-wrap items-center gap-(--space-related)">
            <Heading className="type-page-title text-balance">{title}</Heading>
            {state && <div className="shrink-0">{state}</div>}
          </div>
          {meta && <div className="flex flex-wrap items-center gap-(--space-related)">{meta}</div>}
          {description && (
            <p className="max-w-prose text-muted-foreground text-pretty text-sm">{description}</p>
          )}
        </div>
      </div>
      {actionContent && (
        <ActionGroup className="md:shrink-0 md:justify-end">{actionContent}</ActionGroup>
      )}
    </header>
  );
}
