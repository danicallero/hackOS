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

/** The most specific safe query to run when an operator opens an identity picker. */
export function matchingQuery(person: ImportedIdentity): string {
  const name = completeName(person);
  if (name.length >= 2) return name;

  const partialName = [person.name, person.surname]
    .map((value) => value?.trim() ?? "")
    .find((value) => value.length >= 2);
  if (partialName) return partialName;

  const local = person.email.split("@")[0]?.trim() ?? "";
  return local.length >= 2 ? local : "";
}

/** H17: suggestions are evidence for a human decision, never automatic links. */
export function matchingQueries(person: ImportedIdentity): string[] {
  const fullName = completeName(person);
  return [
    ...new Set(
      [fullName, person.surname, person.name, person.email.split("@")[0]]
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length >= 2),
    ),
  ];
}

/**
 * An identity picker may preselect a single exact full-name match to reduce
 * operator work, but never treats a partial/fuzzy result or duplicate name as
 * a decision. The caller still owns the explicit link mutation.
 */
export function unambiguousFullNameMatch(
  person: ImportedIdentity,
  users: UserOption[],
): UserOption | null {
  const name = completeName(person);
  if (!name) return null;

  const matches = users.filter(
    (user) =>
      searchableIdentity([user.name, user.surname].filter(Boolean).join(" ")) ===
      searchableIdentity(name),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function rankMatchingUsers(
  person: ImportedIdentity,
  users: UserOption[],
  suggestionsOnly = false,
): UserOption[] {
  const name = searchableIdentity([person.name, person.surname].filter(Boolean).join(" "));
  const email = searchableIdentity(person.email);
  const local = email.split("@")[0];
  function score(user: UserOption): number {
    const candidateName = searchableIdentity([user.name, user.surname].filter(Boolean).join(" "));
    const candidateEmail = searchableIdentity(user.email);
    return (
      (candidateEmail === email ? 100 : 0) +
      (person.name?.trim() && person.surname?.trim() && candidateName === name ? 60 : 0) +
      (local.length >= 3 && candidateEmail.split("@")[0] === local ? 30 : 0)
    );
  }
  return users
    .filter((user) => !suggestionsOnly || score(user) > 0)
    .sort((a, b) => score(b) - score(a) || a.email.localeCompare(b.email));
}
