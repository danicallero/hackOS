"use client";

// Immutable challenge version history (H44: "cada cambio guarda una versión,
// para poder saber qué decía el reto en cualquier momento"). Read-only list —
// GET /api/challenges/:id/versions is populated by every update/publish/unpublish
// (apps/api/src/modules/challenges/service.ts snapshotOf()).

import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { useCallback, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { textForDisplay } from "@/lib/challenges";
import { formatEventDate } from "@/lib/datetime";
import { type MessageKey, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export interface VersionSnapshot {
  title: unknown;
  description: unknown;
  criteria: unknown;
  prizes: unknown;
  judging_panel_criteria: unknown;
  available_from: string | null;
  [key: string]: unknown;
}

interface Version {
  id: number;
  editor_id: number | null;
  snapshot: VersionSnapshot;
  created_at: string;
  name: string | null;
  surname: string | null;
}

/** Fields whose change between two consecutive snapshots is worth calling out. */
const TRACKED_FIELDS: { key: keyof VersionSnapshot; labelKey: MessageKey }[] = [
  { key: "title", labelKey: "versionFieldTitle" },
  { key: "description", labelKey: "versionFieldDescription" },
  { key: "criteria", labelKey: "versionFieldCriteria" },
  { key: "prizes", labelKey: "versionFieldPrizes" },
  { key: "judging_panel_criteria", labelKey: "versionFieldJudgingPanel" },
  { key: "available_from", labelKey: "versionFieldReveal" },
];

export function changedFields(
  current: VersionSnapshot,
  previous: VersionSnapshot | null,
): MessageKey[] {
  if (!previous) return [];
  return TRACKED_FIELDS.filter(
    (f) => JSON.stringify(current[f.key]) !== JSON.stringify(previous[f.key]),
  ).map((f) => f.labelKey);
}

/** Human-readable rendering of one snapshot field, for the before/after diff. */
export function fieldValueForDisplay(
  key: keyof VersionSnapshot,
  value: unknown,
  language: Language,
): string {
  if (key === "prizes") {
    const prizes = value as { name?: unknown }[] | null;
    if (!prizes || prizes.length === 0) return "—";
    return prizes.map((p) => (typeof p?.name === "string" ? p.name : "?")).join(", ");
  }
  if (key === "judging_panel_criteria") {
    const questions = value as { key?: unknown; label?: unknown }[] | null;
    if (!questions || questions.length === 0) return "—";
    return questions
      .map((q) => textForDisplay(q?.label as never) || (typeof q?.key === "string" ? q.key : "?"))
      .join(", ");
  }
  if (key === "available_from") {
    return typeof value === "string" && value ? formatEventDate(value, language, "dateTime") : "—";
  }
  return textForDisplay(value as never) || "—";
}

export function VersionHistory({ challengeId }: { challengeId: number }) {
  const { t, language } = useLocale();
  const {
    data,
    error,
    refetch: load,
  } = useLiveQuery(
    () => api.get<{ versions: Version[] }>(`/api/challenges/${challengeId}/versions`),
    domainScope(SSE_TOPICS.SPONSORS),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["challenge", challengeId, "versions"] },
  );
  const versions = data?.versions ?? null;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpanded = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (error) {
    return (
      <ContextualError message={apiErrorText(error, t, t("couldNotLoadVersions"))} onRetry={load} />
    );
  }
  if (versions === null) return <Spinner className="size-5" />;
  if (versions.length === 0) {
    return <EmptyState title={t("noVersionsYetTitle")} />;
  }

  return (
    <ol className="divide-border divide-y">
      {versions.map((version, index) => {
        const previous = versions[index + 1] ?? null; // DESC order: next item is the older one.
        const editorName = [version.name, version.surname].filter(Boolean).join(" ").trim();
        const changed = changedFields(version.snapshot, previous?.snapshot ?? null);
        return (
          <li key={version.id} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                {textForDisplay(version.snapshot.title as never) || t("untitledChallenge")}
              </p>
              <time className="text-muted-foreground text-xs" dateTime={version.created_at}>
                {formatEventDate(version.created_at, language, "dateTime")}
              </time>
            </div>
            <p className="text-muted-foreground text-xs">
              {editorName ? t("editedByLabel", { name: editorName }) : t("editedBySystemLabel")}
            </p>
            {index === versions.length - 1 ? (
              <p className="text-muted-foreground mt-1 text-xs">{t("initialVersionLabel")}</p>
            ) : changed.length > 0 ? (
              <p className="mt-1 text-xs">{changed.map((labelKey) => t(labelKey)).join(", ")}</p>
            ) : null}
            {(changed.length > 0 || index === versions.length - 1) && (
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => toggleExpanded(version.id)}
                className="mt-1"
              >
                {expanded.has(version.id)
                  ? t("hideVersionDetailsLabel")
                  : t("viewVersionDetailsLabel")}
              </Button>
            )}
            {expanded.has(version.id) && (
              <dl className="border-border mt-2 space-y-2 rounded-md border p-2">
                {TRACKED_FIELDS.filter(
                  (f) => index === versions.length - 1 || changed.includes(f.labelKey),
                ).map((f) => (
                  <div key={f.key} className="text-xs">
                    <dt className="text-muted-foreground font-medium">{t(f.labelKey)}</dt>
                    <dd className="mt-0.5 space-y-0.5">
                      {previous && (
                        <p className="text-muted-foreground line-through">
                          {fieldValueForDisplay(f.key, previous.snapshot[f.key], language)}
                        </p>
                      )}
                      <p>{fieldValueForDisplay(f.key, version.snapshot[f.key], language)}</p>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}
