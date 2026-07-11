import { StatusBadge } from "@/components/common/status-badge";
import type { AccreditationLookup, PersonCard, PresenceLookup } from "@/lib/logistics";
import { personName } from "@/lib/logistics";

export function labelForIntolerance(item: { label: unknown }): string {
  if (typeof item.label === "string") return item.label;
  if (item.label && typeof item.label === "object") {
    const label = item.label as Record<string, unknown>;
    return String(label.es ?? label.en ?? label.gl ?? "Intolerance");
  }
  return "Intolerance";
}

/** Shared person card shown at every scanner station (H22, H24, H25, H26). */
export function PersonCardView({
  card,
}: {
  card: AccreditationLookup | PresenceLookup | PersonCard;
}) {
  const intolerances = card.intolerances.map(labelForIntolerance);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{personName(card)}</p>
          <p className="text-muted-foreground text-sm">User #{card.userId}</p>
        </div>
        {"confirmed" in card && (
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={card.confirmed ? "success" : "warning"}>
              {card.confirmed ? "Confirmed" : "Not confirmed"}
            </StatusBadge>
            <StatusBadge tone={card.alreadyAccredited ? "info" : "neutral"}>
              {card.alreadyAccredited ? `Badge ${card.currentBadge}` : "No badge"}
            </StatusBadge>
          </div>
        )}
        {"present" in card && (
          <StatusBadge tone={card.present ? "success" : "neutral"}>
            {card.present ? "Currently inside" : "Currently outside"}
          </StatusBadge>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-xs">Food</p>
          <p className="text-sm">
            {intolerances.length ? intolerances.join(", ") : "No restrictions"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Notes</p>
          <p className="text-sm">{card.foodIntoleranceNotes || card.notes || "No notes"}</p>
        </div>
      </div>
    </div>
  );
}
