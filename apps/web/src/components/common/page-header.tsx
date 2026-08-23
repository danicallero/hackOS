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
}: {
  context?: React.ReactNode;
  /** Visual identity for record pages (an avatar, a logo). Never an action. */
  leading?: React.ReactNode;
  title: string;
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
        "flex flex-col gap-(--space-within-section) sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-(--space-related)">
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0 space-y-1">
          {context && <div className="type-meta">{context}</div>}
          <div className="flex flex-wrap items-center gap-(--space-related)">
            <h1 className="type-page-title text-balance">{title}</h1>
            {state && <div className="shrink-0">{state}</div>}
          </div>
          {meta && <div className="flex flex-wrap items-center gap-(--space-related)">{meta}</div>}
          {description && (
            <p className="text-muted-foreground text-pretty text-sm">{description}</p>
          )}
        </div>
      </div>
      {actionContent && (
        <div className="flex flex-wrap items-center gap-(--space-related) sm:shrink-0 sm:justify-end">
          {actionContent}
        </div>
      )}
    </header>
  );
}
