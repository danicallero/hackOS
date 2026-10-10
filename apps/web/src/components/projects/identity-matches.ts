import type { UserOption } from "@/components/common/user-picker";

export type ImportedIdentity = { name: string | null; surname: string | null; email: string };

export function searchableIdentity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function completeName(person: ImportedIdentity): string {
  const parts = [person.name, person.surname].map((value) => value?.trim() ?? "").filter(Boolean);
  return parts.length === 2 ? parts.join(" ") : "";
}

/**
 * H17: suggestions are evidence for a human decision, never automatic links.
 * Only a complete name or the email handle can score (see `matchScore`), so a
 * lone first name or surname query would add requests without candidates.
 */
export function matchingQueries(person: ImportedIdentity): string[] {
  return [
    ...new Set(
      [completeName(person), person.email.split("@")[0]]
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length >= 2),
    ),
  ];
}

export function matchScore(person: ImportedIdentity, user: UserOption): number {
  const name = searchableIdentity(completeName(person));
  const email = searchableIdentity(person.email);
  const local = email.split("@")[0];
  const candidateName = searchableIdentity([user.name, user.surname].filter(Boolean).join(" "));
  const candidateEmail = searchableIdentity(user.email);
  return (
    (candidateEmail === email ? 100 : 0) +
    (name && candidateName === name ? 60 : 0) +
    (local.length >= 3 && candidateEmail.split("@")[0] === local ? 30 : 0)
  );
}

export function rankMatchingUsers(
  person: ImportedIdentity,
  users: UserOption[],
  suggestionsOnly = false,
): UserOption[] {
  const scores = new Map(users.map((user) => [user.id, matchScore(person, user)]));
  const score = (user: UserOption) => scores.get(user.id) ?? 0;
  return users
    .filter((user) => !suggestionsOnly || score(user) > 0)
    .sort((a, b) => score(b) - score(a) || a.email.localeCompare(b.email));
}

/**
 * The single best-ranked candidate, or null. A tie at the top score, a match
 * weaker than a complete name or exact email, or a truncated candidate list
 * (another equally good account may be missing) never preselects anyone.
 */
export function safeSuggestion(
  person: ImportedIdentity,
  ranked: UserOption[],
  complete: boolean,
): UserOption | null {
  if (!complete || !ranked.length) return null;
  const [first, second] = ranked.map((user) => matchScore(person, user));
  return first >= 60 && first !== second ? ranked[0] : null;
}

export const SUGGESTION_LIMIT = 50;
export const MANUAL_SEARCH_LIMIT = 20;

export type CandidateFetcher = (query: string, limit: number) => Promise<UserOption[]>;

/**
 * Shared identity search for every account picker resolving an imported person
 * (H17). An empty query loads profile-based suggestions; typed text is one
 * bounded manual search. `complete` is false when any request hit its limit.
 */
export async function searchIdentityCandidates(
  person: ImportedIdentity,
  query: string,
  fetchUsers: CandidateFetcher,
): Promise<{ users: UserOption[]; complete: boolean }> {
  const typed = query.trim();
  if (typed) {
    if (typed.length < 2) return { users: [], complete: true };
    const users = await fetchUsers(typed, MANUAL_SEARCH_LIMIT);
    return {
      users: rankMatchingUsers(person, users),
      complete: users.length < MANUAL_SEARCH_LIMIT,
    };
  }
  const queries = matchingQueries(person);
  const results = await Promise.all(queries.map((q) => fetchUsers(q, SUGGESTION_LIMIT)));
  const users = [...new Map(results.flat().map((user) => [user.id, user])).values()];
  return {
    users: rankMatchingUsers(person, users, true),
    complete: results.every((result) => result.length < SUGGESTION_LIMIT),
  };
}
