"use client";

// Immutable challenge version history (H44: "cada cambio guarda una versión,
// para poder saber qué decía el reto en cualquier momento"). Read-only list —
// GET /api/challenges/:id/versions is populated by every update/publish/unpublish
// (apps/api/src/modules/challenges/service.ts snapshotOf()).

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { textForDisplay } from "../shared";

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
const TRACKED_FIELDS: { key: keyof VersionSnapshot; labelKey: string }[] = [
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
): string[] {
  if (!previous) return [];
  return TRACKED_FIELDS.filter(
    (f) => JSON.stringify(current[f.key]) !== JSON.stringify(previous[f.key]),
  ).map((f) => f.labelKey);
}

export function VersionHistory({ challengeId }: { challengeId: number }) {
  const { t } = useLocale();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ versions: Version[] }>(`/api/challenges/${challengeId}/versions`)
      .then((r) => {
        if (alive) setVersions(r.versions);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : t("couldNotLoadVersions"));
      });
    return () => {
      alive = false;
    };
  }, [challengeId, t]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
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
                {new Date(version.created_at).toLocaleString()}
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
          </li>
        );
      })}
    </ol>
  );
}
