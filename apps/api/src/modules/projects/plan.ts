import type { Queryable } from "../../db/pool.js";
import { BadRequestError } from "../../lib/errors.js";
import {
  type DevpostParticipantRow,
  devpostSlugVariants,
  normalizeTitle,
  normalizeUrl,
  parseParticipantsCsv,
  parseProjectsCsv,
  projectRefCandidates,
} from "./csv.js";

/**
 * Shared preview/confirm planning (H16). Parses both CSVs, joins
 * participants to their project, and resolves every member against
 * `users` by primary or verified-secondary email (H6). This is pure
 * read-only work — no writes happen here, so `preview` and `confirm` can
 * both call it and the preview is guaranteed accurate.
 */

export type MemberMatchType = "primary_email" | "secondary_email" | "unmatched";

export interface PlannedMember {
  email: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  matchedUserId: number | null;
  matchedUserName: string | null;
  matchType: MemberMatchType;
}

export interface PlannedRepo {
  title: string;
  url: string | null;
  description: string;
  demoUrl: string | null;
  githubUrl: string | null;
  prizes: string[];
  members: PlannedMember[];
  existingRepoId: number | null;
  action: "create" | "update";
}

export interface PlannedPrize {
  name: string;
  repoCount: number;
  mappedChallengeId: number | null;
  mappedChallengeTitle: string | null;
}

export interface ImportPlan {
  repos: PlannedRepo[];
  prizes: PlannedPrize[];
  /** Participant rows whose project reference didn't resolve to any project row. */
  unassignedParticipants: DevpostParticipantRow[];
  totals: {
    repos: number;
    reposToCreate: number;
    reposToUpdate: number;
    members: number;
    membersMatched: number;
    membersUnmatched: number;
    prizes: number;
  };
}

function resolveProjectIndex(
  ref: string | null,
  byUrl: Map<string, number>,
  byNormUrl: Map<string, number>,
  bySlug: Map<string, number>,
  byTitle: Map<string, number>,
): number | null {
  if (!ref) return null;
  for (const candidate of projectRefCandidates(ref)) {
    const trimmedLower = candidate.trim().toLowerCase();
    if (byUrl.has(trimmedLower)) return byUrl.get(trimmedLower) ?? null;
    const normUrl = normalizeUrl(candidate);
    if (byNormUrl.has(normUrl)) return byNormUrl.get(normUrl) ?? null;
    for (const slug of devpostSlugVariants(candidate)) {
      if (bySlug.has(slug)) return bySlug.get(slug) ?? null;
    }
    const normTitle = normalizeTitle(candidate);
    if (byTitle.has(normTitle)) return byTitle.get(normTitle) ?? null;
  }
  return null;
}

export async function buildImportPlan(
  db: Queryable,
  projectsCsv: string,
  participantsCsv: string,
): Promise<ImportPlan> {
  const projects = parseProjectsCsv(projectsCsv);
  const participants = parseParticipantsCsv(participantsCsv);
  if (projects.length === 0) {
    throw new BadRequestError("projectsCsv has no project rows");
  }

  // Fuzzy (case-insensitive) join keys — participants CSV -> project row.
  const joinByUrl = new Map<string, number>();
  const joinByNormUrl = new Map<string, number>();
  const joinBySlug = new Map<string, number>();
  const joinByTitle = new Map<string, number>();
  projects.forEach((p, i) => {
    if (p.url) {
      const lower = p.url.toLowerCase();
      if (!joinByUrl.has(lower)) joinByUrl.set(lower, i);
      const norm = normalizeUrl(p.url);
      if (!joinByNormUrl.has(norm)) joinByNormUrl.set(norm, i);
      for (const slug of devpostSlugVariants(p.url)) {
        if (slug && !joinBySlug.has(slug)) joinBySlug.set(slug, i);
      }
    }
    const normTitle = normalizeTitle(p.title);
    if (!joinByTitle.has(normTitle)) joinByTitle.set(normTitle, i);
  });

  const allParticipantsByEmail = new Map<string, DevpostParticipantRow>();
  for (const p of participants) allParticipantsByEmail.set(p.email, p);

  const matchesByProjectIndex = new Map<number, DevpostParticipantRow[]>();
  const unassignedParticipants: DevpostParticipantRow[] = [];
  for (const p of participants) {
    const idx = resolveProjectIndex(
      p.projectRef,
      joinByUrl,
      joinByNormUrl,
      joinBySlug,
      joinByTitle,
    );
    if (idx === null) {
      unassignedParticipants.push(p);
      continue;
    }
    const arr = matchesByProjectIndex.get(idx) ?? [];
    arr.push(p);
    matchesByProjectIndex.set(idx, arr);
  }

  const perRepoMembers: DevpostParticipantRow[][] = projects.map((project, i) => {
    const matched = matchesByProjectIndex.get(i) ?? [];
    const membersMap = new Map<string, DevpostParticipantRow>();
    for (const p of matched) membersMap.set(p.email, p);
    for (const email of project.teamMemberEmails) {
      if (!membersMap.has(email)) {
        const enrich = allParticipantsByEmail.get(email);
        membersMap.set(
          email,
          enrich ?? { email, firstName: null, lastName: null, username: null, projectRef: null },
        );
      }
    }
    return [...membersMap.values()];
  });

  // Match members to existing accounts by primary email OR verified
  // secondary email (H6) — unverified secondary emails never match.
  const distinctEmails = [...new Set(perRepoMembers.flat().map((m) => m.email))];
  const primaryMap = new Map<string, { id: number; name: string | null; surname: string | null }>();
  const secondaryMap = new Map<
    string,
    { id: number; name: string | null; surname: string | null }
  >();
  if (distinctEmails.length > 0) {
    const { rows } = await db.query(
      `SELECT id, lower(email) AS email, name, surname,
              lower(secondary_email) AS secondary_email, secondary_email_verified_at
       FROM users
       WHERE lower(email) = ANY($1::text[])
          OR (secondary_email_verified_at IS NOT NULL AND lower(secondary_email) = ANY($1::text[]))`,
      [distinctEmails],
    );
    for (const row of rows as Array<{
      id: number;
      email: string;
      name: string | null;
      surname: string | null;
      secondary_email: string | null;
      secondary_email_verified_at: Date | null;
    }>) {
      if (distinctEmails.includes(row.email)) {
        primaryMap.set(row.email, { id: row.id, name: row.name, surname: row.surname });
      }
      if (
        row.secondary_email &&
        row.secondary_email_verified_at &&
        distinctEmails.includes(row.secondary_email)
      ) {
        secondaryMap.set(row.secondary_email, { id: row.id, name: row.name, surname: row.surname });
      }
    }
  }

  // Existing repos, keyed EXACTLY like the `repos_devpost_url_key` unique
  // index (0300 migration) so this lookup and confirmImport's
  // `ON CONFLICT (devpost_url)` upsert agree on the same row every time.
  const urls = projects.map((p) => p.url).filter((u): u is string => Boolean(u));
  const existingByUrl = new Map<string, number>();
  if (urls.length > 0) {
    const { rows } = await db.query(
      `SELECT id, devpost_url FROM repos WHERE devpost_url = ANY($1::text[])`,
      [urls],
    );
    for (const row of rows as Array<{ id: number; devpost_url: string }>) {
      existingByUrl.set(row.devpost_url, row.id);
    }
  }
  // Best-effort dedupe for projects with no Devpost URL at all: match by
  // exact name among repos that also have no URL. Documented limitation —
  // see 0300 migration and the workstream report.
  const namesWithoutUrl = projects.filter((p) => !p.url).map((p) => p.title);
  const existingByNullUrlName = new Map<string, number>();
  if (namesWithoutUrl.length > 0) {
    const { rows } = await db.query(
      `SELECT id, name FROM repos WHERE devpost_url IS NULL AND name = ANY($1::text[])`,
      [namesWithoutUrl],
    );
    for (const row of rows as Array<{ id: number; name: string }>) {
      if (!existingByNullUrlName.has(row.name)) existingByNullUrlName.set(row.name, row.id);
    }
  }

  const repos: PlannedRepo[] = projects.map((project, i) => {
    const members: PlannedMember[] = (perRepoMembers[i] ?? []).map((m) => {
      const primary = primaryMap.get(m.email);
      const secondary = primary ? undefined : secondaryMap.get(m.email);
      const match = primary ?? secondary;
      const matchType: MemberMatchType = primary
        ? "primary_email"
        : secondary
          ? "secondary_email"
          : "unmatched";
      return {
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        username: m.username,
        matchedUserId: match?.id ?? null,
        matchedUserName: match
          ? [match.name, match.surname].filter(Boolean).join(" ") || null
          : null,
        matchType,
      };
    });
    const existingRepoId = project.url
      ? (existingByUrl.get(project.url) ?? null)
      : (existingByNullUrlName.get(project.title) ?? null);
    return {
      title: project.title,
      url: project.url,
      description: project.description,
      demoUrl: project.demoUrl,
      githubUrl: project.githubUrl,
      prizes: project.prizes,
      members,
      existingRepoId,
      action: existingRepoId ? ("update" as const) : ("create" as const),
    };
  });

  const prizeRepoCount = new Map<string, number>();
  for (const repo of repos) {
    for (const p of new Set(repo.prizes)) {
      prizeRepoCount.set(p, (prizeRepoCount.get(p) ?? 0) + 1);
    }
  }
  const prizeNames = [...prizeRepoCount.keys()];
  const challengeByPrize = new Map<string, { id: number; title: string }>();
  if (prizeNames.length > 0) {
    const { rows } = await db.query(
      `SELECT id, title, devpost_tags FROM challenges WHERE devpost_tags ?| $1::text[]`,
      [prizeNames],
    );
    for (const row of rows as Array<{ id: number; title: string; devpost_tags: string[] }>) {
      for (const tag of row.devpost_tags) {
        if (prizeRepoCount.has(tag) && !challengeByPrize.has(tag)) {
          challengeByPrize.set(tag, { id: row.id, title: row.title });
        }
      }
    }
  }
  const prizes: PlannedPrize[] = prizeNames.map((name) => {
    const mapped = challengeByPrize.get(name);
    return {
      name,
      repoCount: prizeRepoCount.get(name) ?? 0,
      mappedChallengeId: mapped?.id ?? null,
      mappedChallengeTitle: mapped?.title ?? null,
    };
  });

  const allMembers = repos.flatMap((r) => r.members);
  return {
    repos,
    prizes,
    unassignedParticipants,
    totals: {
      repos: repos.length,
      reposToCreate: repos.filter((r) => r.action === "create").length,
      reposToUpdate: repos.filter((r) => r.action === "update").length,
      members: allMembers.length,
      membersMatched: allMembers.filter((m) => m.matchType !== "unmatched").length,
      membersUnmatched: allMembers.filter((m) => m.matchType === "unmatched").length,
      prizes: prizes.length,
    },
  };
}
