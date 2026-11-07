/** Escape LIKE/ILIKE wildcards so user input matches literally (Postgres default escape is `\`). */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/** `%input%` pattern for a case-insensitive "contains" search over user text. */
export function likeContains(input: string): string {
  return `%${escapeLike(input)}%`;
}
