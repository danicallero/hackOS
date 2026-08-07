import { StatusBadge } from "@/components/common/status-badge";
import { useLocale } from "@/lib/i18n";
import type { PersonSearchResult } from "@/lib/logistics";

/** i18n key for how a search result matched — null for the plain name/email fallback. */
const MATCH_LABEL_KEY: Record<PersonSearchResult["matchedBy"], string | null> = {
  ticket: "matchTicket",
  badge: "matchBadge",
  badge_history: "matchOldBadge",
  profile: null,
};

/** Reusable person search results list — used in accreditation and activity scanner (H22-H26). */
export function PersonSearchResults({
  results,
  onSelect,
}: {
  results: PersonSearchResult[];
  onSelect: (person: PersonSearchResult) => void;
}) {
  const { t } = useLocale();

  if (results.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("noResultsLabel")}</p>;
  }

  return (
    <div className="rounded-lg border">
      {results.map((person) => {
        const matchKey = MATCH_LABEL_KEY[person.matchedBy];
        return (
          <button
            key={person.userId}
            type="button"
            className="hover:bg-muted flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0"
            onClick={() => onSelect(person)}
          >
            <span>
              <span className="block text-sm font-medium">
                {[person.name, person.surname].filter(Boolean).join(" ") || person.email}
              </span>
              <span className="text-muted-foreground block text-xs">{person.email}</span>
            </span>
            <span className="flex flex-wrap justify-end gap-2">
              {matchKey && (
                <StatusBadge tone="info" dot={false}>
                  {t(matchKey)}
                </StatusBadge>
              )}
              <StatusBadge tone={person.badgeId ? "info" : "neutral"} dot={false}>
                {person.badgeId ?? t("noBadge")}
              </StatusBadge>
              {"confirmed" in person && (
                <StatusBadge tone={person.confirmed ? "success" : "neutral"} dot={false}>
                  {person.confirmed ? t("confirmedStatus") : t("noAppStatus")}
                </StatusBadge>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
