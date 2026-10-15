"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/common/status-badge";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import type { NativeProject } from "@/lib/native-projects";
import { projectSummary } from "@/lib/project-text";

/** The first photo of the project's first photo field, as a list thumbnail (H16). */
function coverPhoto(project: NativeProject) {
  for (const field of project.template)
    if (field.kind === "images") {
      const keys = project.responses[field.key];
      const first = Array.isArray(keys) ? keys[0] : undefined;
      const file = project.files?.find((entry) => entry.objectKey === first);
      if (file) return new URL(file.thumbnailUrl ?? file.url, API_URL).toString();
    }
  return null;
}

/** H20: one project in a participant's list — name, state, a clipped summary and context. */
export function ProjectListRow({ project, href }: { project: NativeProject; href: string }) {
  const { t, language } = useLocale();
  const summary = projectSummary(project.description, project.name);
  const cover = coverPhoto(project);
  const challenges = project.challenges
    .map((challenge) =>
      typeof challenge.title === "string"
        ? challenge.title
        : challenge.title[language] || challenge.title.en,
    )
    .join(" · ");
  const team = project.members
    .filter((member) => member.status === "active" && member.name)
    .map((member) => member.name)
    .join(", ");
  const submitted = project.submissionStatus === "submitted";
  return (
    <Link
      href={href}
      className="hover:bg-muted/50 flex min-w-0 items-start gap-4 rounded-lg border px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {cover && (
        // biome-ignore lint/performance/noImgElement: authenticated API image, not a Next asset
        <img src={cover} alt="" className="bg-muted h-16 w-24 shrink-0 rounded-md object-cover" />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="truncate font-medium">{project.name}</span>
          <StatusBadge className="shrink-0" tone={submitted ? "success" : "neutral"} dot={false}>
            {t(submitted ? "dataStatusSubmitted" : "dataStatusDraft")}
          </StatusBadge>
        </div>
        {summary && (
          <p className="text-muted-foreground line-clamp-2 text-sm text-pretty">{summary}</p>
        )}
        {(challenges || team) && (
          <p className="text-muted-foreground truncate text-xs">
            {[challenges, team].filter(Boolean).join("  ·  ")}
          </p>
        )}
      </div>
    </Link>
  );
}
