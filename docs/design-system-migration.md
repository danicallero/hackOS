# Shared visual foundation migration

This guide implements the foundation in [`docs/ux-ui-audit.md`](./ux-ui-audit.md),
section 4. It changes visual hierarchy only: capability checks, workflow states,
navigation, scanner synchronization, judging transitions, and domain rules stay with
their owning issues.

## Token contract

The canonical tokens live in `apps/web/src/app/globals.css`.

| Concern | Contract |
| --- | --- |
| Spacing | 8px related controls, 16px within sections, 24px between sections; all spacing remains on the 4px grid |
| Type | Page title 24/32 semibold, section title 18/24 semibold, body 14/20, label 13/18 medium, metadata 12/16 without artificial tracking |
| Controls | 36px default, 32px compact, 40px prominent; 6px radius |
| Surfaces | 8px radius, semantic border and background, no shadow for inline grouping |
| Overlays | 8px radius; small shadow for menus/popovers and large shadow for modal dialogs |
| Data | Use `tabular-nums`; reserve monospace for identifiers and timers |

Use the named typography classes `type-page-title`, `type-section-title`,
`type-label`, and `type-meta`. Do not add `tracking-*` to shared headings or
metadata.

## Pick the correct container

- `Surface` is an untitled, border-only inline group.
- `Section` is a semantic page section. `SectionCard` composes it for the common
  title/state/action/body structure and remains compatible with existing call sites.
- `Overlay` is interaction-owned content rendered by Radix. Dialog, popover, and
  dropdown content consume `overlayVariants`; do not use overlay shadows on inline
  content.
- `Card` remains as a compatibility wrapper over `Surface`. New domain sections
  should prefer `Section` or `SectionCard` so their responsibility is explicit.

```tsx
<SectionCard
  title={t("roomQueues")}
  state={<StatusBadge>{rooms.length}</StatusBadge>}
  action={<Button variant="outline">{t("viewAll")}</Button>}
>
  {children}
</SectionCard>
```

## Page and action hierarchy

`PageHeader` defaults to title-first hierarchy. Use `context` for a breadcrumb or
workspace label and `state` for a nearby count/status. Add `description` only for a
policy, risk, consequence, or unfamiliar state; never repeat the title or enumerate
the visible content.

Give each scope one `primaryAction`. Put common supporting work in
`secondaryActions` using outline or ghost buttons. Put rare or exceptional actions in
a Radix dropdown menu. The legacy `actions` prop remains temporarily for staged
migration.

```tsx
<PageHeader
  title={t("queueOperations")}
  primaryAction={<Button>{t("generateQueues")}</Button>}
  secondaryActions={<Button variant="outline">{t("openJudging")}</Button>}
/>
```

Disabled transactional actions must keep their reason next to the control (helper or
status text) and connect it with `aria-describedby` when the reason is not already in
the accessible name. Icon-only actions still require a localized accessible name.

## Representative migrations

- Participant: `app/(app)/my-applications/page.tsx` removes repeated explanatory
  copy and places response/open-form counts beside section titles (H12, H14-H15).
- Administration: `app/(app)/permissions/page.tsx` makes “New group” the single page
  primary action and removes instructional/card-tracking hierarchy (H8, H55).
- Live operations: `app/(app)/queue/page.tsx` separates queue generation from the
  secondary judging destination without changing queue or judging states
  (H29-H40, H55).

## Remaining staged migration

At foundation time there are 59 `PageHeader` and 73 `SectionCard` call sites. Follow-up
domain owners should remove redundant descriptions and adopt explicit action priority
while they already own those screens. Highest-value remaining groups are applications
and decisions, project import/editing, logistics/scanners, judging, programme/TV,
sponsors, event settings, users/audit, and participant project/queue/wallet screens.

Use these commands to refresh the inventory without broad formatting changes:

```sh
rg -n '<PageHeader' apps/web/src/app apps/web/src/components
rg -n '<SectionCard' apps/web/src/app apps/web/src/components
rg -n 'tracking-(tight|wide|wider|widest)' apps/web/src/components
```
