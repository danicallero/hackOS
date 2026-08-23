import { LockIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { useLocale } from "@/lib/i18n";

/** Capability-denied page state (issue #298) — a rendering component, not a
 *  gate; see `CapabilityGate` in `common/capability-gate.tsx` for that.
 *  `ask` is the per-page label under the shared heading. */
export function AccessDenied({ ask }: { ask: string }) {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <PageHeader title={t("noAccessTitle")} />
      <EmptyState icon={LockIcon} title={ask} />
    </div>
  );
}
