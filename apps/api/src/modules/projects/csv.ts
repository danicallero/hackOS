import { parse } from "csv-parse/sync";
import { BadRequestError } from "../../lib/errors.js";

/**
 * Devpost CSV parsing (H16). Devpost's exports are two separate files with
 * headers that vary slightly release to release, so headers are matched
 * case/whitespace-insensitively against a small alias table instead of
 * requiring an exact column name.
 *
 * Expected "projects" export — one row per submitted project:
 *   - Project Title            (required)              -> title
 *   - Project Url / Submission Url                       -> url (dedupe key)
 *   - Description / About the Project / Elevator Pitch    -> description
 *   - Try it out Links / Demo Url / Video Demo Link        -> demoUrl
 *   - Opt-In Prizes / Prizes (comma/semicolon separated)   -> prizes[]
 *   - Team Members (free text, "Name (email), Name (email)" or bare emails)
 *     OR numbered columns "Team Member N Email" (real Devpost exports)
 *                                                           -> teamMemberEmails[]
 *     (fallback only — the participants export below is the primary source
 *     of team membership; these columns just catch members the
 *     participants export didn't reference back to this project)
 *
 * Expected "participants" export — one row per person per project:
 *   - Email / Email Address    (required)              -> email
 *   - First Name                                          -> firstName
 *   - Last Name                                            -> lastName
 *   - Devpost Username / Username / Online Profiles        -> username
 *   - Project Title / Project Url / Submission Url         -> projectRef
 *     (links the participant row back to a project row above, by exact URL
 *     match first, then case-insensitive title match)
 */

export interface DevpostProjectRow {
  title: string;
  url: string | null;
  description: string;
  demoUrl: string | null;
  prizes: string[];
  teamMemberEmails: string[];
}

export interface DevpostParticipantRow {
  email: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  projectRef: string | null;
}

const PROJECT_FIELD_ALIASES: Record<string, string[]> = {
  title: ["projecttitle", "title", "name"],
  url: ["projecturl", "submissionurl", "devposturl", "url"],
  description: ["description", "abouttheproject", "elevatorpitch", "tagline", "summary"],
  demoUrl: ["tryitoutlinks", "demourl", "videodemolink", "video", "videourl"],
  prizes: ["optinprizes", "optinprize", "prizes", "prize"],
  teamMembers: ["teammembers", "members", "team"],
};

const PARTICIPANT_FIELD_ALIASES: Record<string, string[]> = {
  email: ["email", "emailaddress"],
  firstName: ["firstname"],
  lastName: ["lastname"],
  username: ["devpostusername", "username", "onlineprofiles"],
  projectRef: [
    "projecttitle",
    "projecttitles",
    "projectname",
    "projectnames",
    "projecturl",
    "projecturls",
    "submissionurl",
    "submissionurls",
    "project",
  ],
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "") // strip BOM if csv-parse left it on the first header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildFieldMap(
  rawHeaders: string[],
  aliases: Record<string, string[]>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of rawHeaders) {
    const norm = normalizeHeader(raw);
    for (const [canonical, aliasList] of Object.entries(aliases)) {
      if (aliasList.includes(norm)) {
        map.set(raw, canonical);
        break;
      }
    }
  }
  return map;
}

function remapRow(
  row: Record<string, string>,
  fieldMap: Map<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [raw, value] of Object.entries(row)) {
    const canonical = fieldMap.get(raw);
    if (canonical && !(canonical in out)) out[canonical] = value ?? "";
  }
  return out;
}

function parseCsvRows(csvText: string, fileLabel: string): Record<string, string>[] {
  try {
    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Record<string, string>[];
    return rows;
  } catch (err) {
    throw new BadRequestError(`Could not parse ${fileLabel}: ${(err as Error).message}`);
  }
}

export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function extractEmails(value: string | undefined): string[] {
  if (!value) return [];
  const matches = value.match(EMAIL_RE) ?? [];
  return [...new Set(matches.map((e) => e.toLowerCase()))];
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export function normalizeDevpostSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^.*\/(submissions|software)\//, "")
    .replace(/^\d+-/, "")
    .replace(/\/+$/, "");
}

export function projectRefCandidates(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseProjectsCsv(csvText: string): DevpostProjectRow[] {
  const rows = parseCsvRows(csvText, "projectsCsv");
  const headerRow = rows[0];
  if (!headerRow) return [];
  const fieldMap = buildFieldMap(Object.keys(headerRow), PROJECT_FIELD_ALIASES);
  if (![...fieldMap.values()].includes("title")) {
    throw new BadRequestError(
      "projectsCsv is missing a recognizable title column (expected 'Project Title')",
    );
  }

  // Real Devpost exports carry one column per team slot ("Team Member 1
  // Email", "Team Member 2 Email"…) instead of a single free-text column.
  const numberedEmailColumns = Object.keys(headerRow).filter((h) =>
    /^teammember\d+email$/.test(normalizeHeader(h)),
  );

  const out: DevpostProjectRow[] = [];
  for (const raw of rows) {
    const row = remapRow(raw, fieldMap);
    const title = row.title?.trim();
    if (!title) continue; // blank trailing row
    const url = row.url?.trim() || null;
    const memberEmails = new Set(extractEmails(row.teamMembers));
    for (const col of numberedEmailColumns) {
      for (const email of extractEmails(raw[col])) memberEmails.add(email);
    }
    out.push({
      title,
      url,
      description: row.description?.trim() ?? "",
      demoUrl: row.demoUrl?.trim() || null,
      prizes: splitList(row.prizes),
      teamMemberEmails: [...memberEmails],
    });
  }
  return out;
}

export function parseParticipantsCsv(csvText: string): DevpostParticipantRow[] {
  const rows = parseCsvRows(csvText, "participantsCsv");
  const headerRow = rows[0];
  if (!headerRow) return [];
  const fieldMap = buildFieldMap(Object.keys(headerRow), PARTICIPANT_FIELD_ALIASES);
  if (![...fieldMap.values()].includes("email")) {
    throw new BadRequestError(
      "participantsCsv is missing a recognizable email column (expected 'Email')",
    );
  }

  const out: DevpostParticipantRow[] = [];
  for (const raw of rows) {
    const row = remapRow(raw, fieldMap);
    const email = row.email?.trim().toLowerCase();
    if (!email) continue;
    out.push({
      email,
      firstName: row.firstName?.trim() || null,
      lastName: row.lastName?.trim() || null,
      username: row.username?.trim() || null,
      projectRef: row.projectRef?.trim() || null,
    });
  }
  return out;
}
