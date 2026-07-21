import { LockIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { useLocale } from "@/lib/i18n";

/**
 * The one capability-denied page state (issue #298). Nineteen pages used to
 * hand-roll this block with a dedicated title key each, so one message cost 38
 * dictionary entries and had already started drifting apart.
 *
 * The heading is the same everywhere because the fact is the same everywhere;
 * the only per-page string is `ask`, which names the access to request. It is
 * a rendering component, not a gate: the page keeps its own capability check
 * (and the API still enforces it — H8).
 */
export function AccessDenied({ ask }: { ask: string }) {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <PageHeader title={t("noAccessTitle")} />
      <EmptyState icon={LockIcon} title={ask} />
    </div>
  );
}
