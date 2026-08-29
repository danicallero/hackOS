import { StatusBadge } from "@/components/common/status-badge";
import { useLocale } from "@/lib/i18n";
import type { AccreditationLookup, PersonCard, PresenceLookup } from "@/lib/logistics";
import { personName } from "@/lib/logistics";

export function labelForIntolerance(item: { label: unknown }, fallback: string): string {
  if (typeof item.label === "string") return item.label;
  if (item.label && typeof item.label === "object") {
    const label = item.label as Record<string, unknown>;
    return String(label.es ?? label.en ?? label.gl ?? fallback);
  }
  return fallback;
}

/** Shared person card shown at every scanner station (H22, H24, H25, H26). */
export function PersonCardView({
  card,
}: {
  card: AccreditationLookup | PresenceLookup | PersonCard;
}) {
  const { t } = useLocale();
  const intolerances = card.intolerances.map((item) =>
    labelForIntolerance(item, t("intoleranceFallback")),
  );
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{personName(card)}</p>
          {card.userId != null && (
            <p className="text-muted-foreground text-sm">
              {t("userNumberFallback", { id: card.userId })}
            </p>
          )}
        </div>
        {"confirmed" in card && (
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={card.confirmed ? "success" : "warning"}>
              {card.confirmed ? t("confirmed") : t("notConfirmed")}
            </StatusBadge>
            <StatusBadge tone={card.alreadyAccredited ? "info" : "neutral"}>
              {card.alreadyAccredited
                ? t("badgeCapitalInline", { badge: card.currentBadge ?? "" })
                : t("noBadge")}
            </StatusBadge>
          </div>
        )}
        {"present" in card && (
          <StatusBadge tone={card.present ? "success" : "neutral"}>
            {card.present ? t("currentlyInside") : t("currentlyOutside")}
          </StatusBadge>
        )}
      </div>
      {"dni" in card && (
        <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">{t("dniLabel")}</p>
            <p className="text-sm font-medium">{card.dni || "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("email")}</p>
            <p className="text-sm break-all">{card.email || "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("shirtSize")}</p>
            <p className="text-sm">{card.shirtSize || "—"}</p>
          </div>
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-xs">{t("foodLabel")}</p>
          <p className="text-sm">
            {intolerances.length ? intolerances.join(", ") : t("noRestrictions")}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t("notesLabel")}</p>
          <p className="text-sm">{card.foodIntoleranceNotes || card.notes || t("noNotes")}</p>
        </div>
      </div>
    </div>
  );
}
