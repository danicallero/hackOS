import { cn } from "@/lib/utils";

/**
 * Quiet empty/zero state: a title, an optional line saying why, and at most one
 * action. Type and spacing carry the hierarchy; there is no icon or tinted
 * container (docs/DESIGN.md §6). Reuse for "no results", "nothing yet", failed
 * loads, etc.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  /** Secondary line under the title, e.g. why the state is empty. */
  description?: string;
  /** The one thing to do next, e.g. a "Create" button. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="w-full min-w-0 space-y-1">
        <p className="text-sm font-medium text-balance">{title}</p>
        {description && (
          <p className="text-muted-foreground mx-auto w-full max-w-sm wrap-break-word whitespace-normal text-sm text-pretty">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
