/**
 * Applications module (H12, H56): file fields carry an optional
 * shareable_with_sponsors flag; the applicant's per-response consent is
 * stored as a sibling key in the free-form `responses` jsonb, next to the
 * uploaded file's own key. Both API and web import this convention from one
 * place so the `__shared_with_sponsors` suffix never drifts between them.
 */
export function sponsorShareKey(fieldKey: string): string {
  return `${fieldKey}__shared_with_sponsors`;
}
