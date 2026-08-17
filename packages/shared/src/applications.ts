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

/**
 * Reserved question keys (H11/H12): a form-builder field whose `key` matches
 * one of these, case-insensitively, is synced with the matching `users`
 * profile column instead of staying a plain custom answer — the applicant's
 * existing profile value prefills the question, and a submitted answer is
 * mirrored back onto the profile.
 *
 * To add a new one:
 * 1. Add the `users` column (migration) if it doesn't exist yet, and make
 *    sure `Me` (`apps/web/src/lib/types.ts`) / `GET /api/me` already expose
 *    it — every reserved key so far already needed the profile value there
 *    for other reasons (the profile page, invites, etc.), so this is usually
 *    a no-op.
 * 2. Wire the sync-on-submit in `apps/api/src/modules/applications/service.ts`
 *    (`extractDni` is the template — write an `extractX` and call it
 *    alongside it in `submitResponse`).
 * 3. Wire the prefill-on-open in
 *    `apps/web/src/app/(app)/my-applications/[id]/page.tsx` (`load`'s seeding
 *    block) — find the template field whose key matches and, if the saved
 *    response doesn't already have a value, seed it from `me`.
 * 4. Add the entry below, plus its explainer copy in `RESERVED_KEY_DESC`
 *    (apps/web/.../applications/[id]/questions-card.tsx) and an i18n message
 *    for it — the form builder's key-identifier explainer and its "you
 *    forgot X" save warning both read `RESERVED_FIELD_KEYS` directly.
 */
export const RESERVED_FIELD_KEYS = [{ key: "dni" }] as const;
