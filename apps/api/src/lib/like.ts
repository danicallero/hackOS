/** Escape LIKE/ILIKE wildcards so user input matches literally (Postgres default escape is `\`). */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/** `%input%` pattern for a case-insensitive "contains" search over user text. */
export function likeContains(input: string): string {
  return `%${escapeLike(input)}%`;
}

/** One `%word%` pattern per whitespace-separated word, so "ana perez" matches name "Ana" + surname "Pérez". */
export function likeTokens(input: string): string[] {
  return input.split(/\s+/).filter(Boolean).map(likeContains);
}

/** SQL: every token from `likeTokens` (bound as `text[]` at `param`) appears, accent-insensitively, in `expr`. */
export function matchesAllTokens(expr: string, param: string): string {
  return `unaccent(${expr}) ILIKE ALL (SELECT unaccent(t) FROM unnest(${param}::text[]) t)`;
}
