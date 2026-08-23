import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** A "‹ Back" navigation link for the top of a detail/edit page. */
export function BackLink({
  href,
  label,
}: {
  /** Destination of the back link, e.g. the parent list page. */
  href: string;
  /** Text (or richer node) shown next to the arrow icon. */
  label: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      {label}
    </Link>
  );
}
