import { StatusBadge } from "@/components/common/status-badge";
import { type ActivityScanResult, personName } from "@/lib/logistics";
import { cn } from "@/lib/utils";
import { PersonCardView } from "./person-card";

/** Result of a meal/activity scan (H25/H26): first-time vs repeat, person card. */
export function ScanResult({ result }: { result: ActivityScanResult }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        result.repeat ? "border-warning/50 bg-warning/10" : "border-success/40 bg-success/10",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{personName(result.card)}</p>
          <p className="text-muted-foreground text-sm">
            {result.firstTime ? "First scan" : `Repeat scan · ${result.timesEaten} total`}
          </p>
        </div>
        <StatusBadge tone={result.repeat ? "warning" : "success"}>
          {result.repeat ? "Repeat" : "Registered"}
        </StatusBadge>
      </div>
      <div className="mt-3">
        <PersonCardView card={result.card} />
      </div>
    </div>
  );
}
