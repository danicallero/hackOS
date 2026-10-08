import type { UserOption } from "@/components/common/user-picker";

type ImportedIdentity = { name: string | null; surname: string | null; email: string };

export function searchableIdentity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

/** H17: suggestions are evidence for a human decision, never automatic links. */
export function matchingQueries(person: ImportedIdentity): string[] {
  return [
    ...new Set(
      [person.surname, person.name, person.email.split("@")[0]]
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length >= 2),
    ),
  ].slice(0, 3);
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
