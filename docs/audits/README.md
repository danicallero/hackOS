# Closed audits and project trackers

Not required reading. Everything here is a finished piece of work — a task
DAG, a findings-and-fix list, an audit brief — kept because it records *why*
a design decision was made, not because it describes the system as it stands
today. Each file says so at the top (`Status: implementation complete` /
`superseded`).

If you need to know how something currently works, read the matching file in
`docs/` (see `docs/README.md`), not these. A doc here gets linked from a
living doc only when it holds rationale that would otherwise be lost — e.g.
`api-reference.md` or `notifications.md` citing a specific design call from
`access-control-audit-plan.md`.

- [Access-control audit and consolidation plan](./access-control-audit-plan.md)
  — the H8 role-hierarchy rewrite: release gate and the design rationale
  still cited from `docs/notifications.md` and `docs/event-config-wallet.md`.
  Superseded by
  [`../access-control-route-ledger.md`](../access-control-route-ledger.md)
  (generated, living) for the current route-policy state.
- [Web UX simplification audit and task plan](./ux-audit-tasks.md) — the
  screen-inventory pass that shaped the current information architecture.
- [Application form builder UX audit](./ux-audit-application-builder.md) —
  findings and fix plan for the create-form modal and builder, since applied.
- [Applications & identity: implementation notes](./implementation-notes.md)
  — a log of specific past changes and bug fixes (invitations, application
  status transitions, review IA, sponsor file export) with their rationale.
  Not a description of current behavior — see `api-reference.md` and
  `account-deletion.md` for that.
