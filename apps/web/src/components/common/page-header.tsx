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
  reserveNavigation = true,
}: {
  context?: React.ReactNode;
  /**
   * Visual identity for record pages (an avatar, a logo). Never a page action;
   * the only control it may hold is a menu that edits that same image.
   */
  leading?: React.ReactNode;
  title: string;
  /** Embedded design specimens use h2; destinations always keep the default h1. */
  headingLevel?: 1 | 2;
  /** Narrow screens leave room for the app's sidebar trigger; public pages have none. */
  reserveNavigation?: boolean;
  /** Record state; leads the line under the title, ahead of `meta`, never beside the title. */
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
        "flex min-h-(--control-height-default) flex-col gap-(--space-within-section) md:flex-row md:items-start md:justify-between",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-start gap-(--space-related) md:pl-0",
          // The sidebar control sits beside a shell notice when one is shown, not over the title.
          reserveNavigation && "pl-12 group-has-[[data-shell-notice]]/shell:pl-0 md:pl-0",
        )}
      >
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0 space-y-1">
          {context && <div className="type-meta">{context}</div>}
          <div className="heading-row min-h-(--line-height-page-title) flex flex-wrap items-center gap-(--space-related)">
            <Heading className="type-page-title text-balance">{title}</Heading>
          </div>
          {(state || meta) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {state}
              {meta}
            </div>
          )}
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
