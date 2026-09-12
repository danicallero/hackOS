import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function JudgingEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-md border border-dashed p-6 text-center",
        className,
      )}
    >
      <Icon aria-hidden="true" className="text-muted-foreground mb-3 size-8" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
