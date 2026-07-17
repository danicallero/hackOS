import { cn } from "@/lib/utils";

/**
 * Title-first page hierarchy for authenticated screens. Descriptions are for
 * exceptional policy or risk copy; actions expose their priority explicitly.
 */
export function PageHeader({
  context,
  title,
  state,
  description,
  primaryAction,
  secondaryActions,
  actions,
  className,
}: {
  context?: React.ReactNode;
  title: string;
  state?: React.ReactNode;
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
        "flex flex-col gap-[var(--space-within-section)] sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {context && <div className="type-meta">{context}</div>}
        <div className="flex flex-wrap items-center gap-[var(--space-related)]">
          <h1 className="type-page-title text-balance">{title}</h1>
          {state && <div className="shrink-0">{state}</div>}
        </div>
        {description && <p className="text-muted-foreground text-pretty text-sm">{description}</p>}
      </div>
      {actionContent && (
        <div className="flex flex-wrap items-center gap-[var(--space-related)] sm:shrink-0 sm:justify-end">
          {actionContent}
        </div>
      )}
    </header>
  );
}
