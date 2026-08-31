# Access-control audit and consolidation plan

Status: **implemented and independently release-gate verified (2026-07-31);
superseded by the H8 role-hierarchy rewrite below (2026-08-31)**.
The historical baseline and task DAG remain below for traceability; the generated runtime ledger is
[`access-control-route-ledger.md`](./access-control-route-ledger.md).

Stories: H1–H10 (identity and the role hierarchy), H11–H15
(applications), H16–H21 (projects), H28 (wallet), H29–H46 (queue, judging,
TV, sponsors), H47–H54 (content, communications, audit, and exports), and H55
(capability-based navigation).

This document is the implementation and Orca-orchestration brief for making
access control mechanically auditable across the API and its clients. The
normative functional source remains
[`plan/historias-hackos.md`](../plan/historias-hackos.md), and the hard
permission, concurrency, and broadcast invariants remain in
[`plan/07-datos-relevantes-ers.md`](../plan/07-datos-relevantes-ers.md). If
this brief conflicts with either file, `plan/` wins.

## H8 role-hierarchy rewrite (current architecture)

The section below ("Goal and non-goals" through "Historical audit baseline")
describes the capability-group era of this system and is kept for
traceability; its claim that this work "does not replace capability-based
authorization with roles" is **no longer true** — the repo owner explicitly
approved inverting that architecture. This is the current model:

- **Data model**: `roles` (id, name, `position` — one global reorderable
  hierarchy, higher = more priority — `is_visible`, `is_protected`);
  `role_capabilities` (role_id, capability, `state` ALLOW/DENY/INHERIT,
  missing row == INHERIT); `user_roles` (a user may hold several roles);
  `role_grant_rules` (role_id, `trigger_event`, `action` grant/revoke — a
  generic hook for automatic role assignment, decoupled from any specific
  domain); `applications.grants_role_id` (a role granted alongside ticket
  issuance on confirmation).
- **Resolution** (`apps/api/src/lib/capabilities.ts`, backed by the
  `user_effective_capabilities` SQL view): for a capability, walk the user's
  OWN assigned roles ordered by position descending; the first ALLOW/DENY
  wins; INHERIT skips to the next-lower-position role the user ALSO holds
  (never to the next role in the global hierarchy — a role the user doesn't
  have is invisible to their chain); an all-INHERIT chain, or no roles,
  denies. `*` still means every capability. `userHasCapability`,
  `requireCapability`, and `requireAnyCapability` keep their existing
  signatures, so call sites across the codebase are unchanged.
- **Admin-hierarchy authority** (`apps/api/src/modules/identity/
  role-authority.ts`, replacing `permission-graph.ts`): to assign, remove,
  edit, or reorder a role, the actor needs `permissions:manage` AND the
  role's position — its NEW position, for a reorder — must sit strictly
  below the actor's own highest assigned-role position. An advisory lock
  (`lockRoleGraph`, mirroring the old `lockPermissionGraph`) serializes
  mutations to `roles.position`/`role_capabilities`; `assertActiveWildcardHolder`
  keeps at least one active user resolving `*` to ALLOW after any mutation.
- **Capability-possession authority** (`role-authority.ts`'s
  `requireCapabilityPossessionForStateChange` and
  `requireCapabilityPossessionForAssignment`): a second, independent guard on
  the same routes, gating capability *content* rather than role *position* —
  both checks must pass, neither substitutes for the other. An actor who
  doesn't resolve `*` (ADMIN_ALL) themselves can only set a role's capability
  to ALLOW or DENY for a capability they currently possess themselves
  (`PUT /api/roles/:roleId/capabilities`); setting to INHERIT is exempt,
  since it removes an override rather than asserting one. Assigning a role to
  a user (`POST /api/roles/:roleId/users/:userId`) requires the actor to
  already possess every capability the role's own `role_capabilities` rows
  explicitly ALLOW (ignoring what the assignee's other roles would
  contribute) — a pure-INHERIT scaffold role trivially passes. Holding
  `permissions:manage` alone does not exempt an actor from this guard; only
  an actual `*` resolution does. Unassigning a role needs no such guard —
  revoking membership grants nothing.
- **Migration** (`db/migrations/0800`–`0805`; see "`system:superadmin` is
  CLI-only", "Soft-delete and restore", and "Default seeded role set" below
  for 0804/0805): 0801 is a true DATA migration, not a seed — of the 20 H8
  platform templates (`templates.ts`), a template becomes a named role with
  its capabilities as ALLOW only if some pre-existing `permission_groups` row
  actually instantiated it (`template_key` set, from 0105); every
  `permission_group_members` row for such a group is mapped onto the
  matching role (by `template_key`), and any custom/ad-hoc group gets a
  bespoke role carrying its exact effective capability set. A fresh install
  has zero `permission_groups` rows, so 0801 creates zero template-derived
  roles there — 0805 alone supplies the fresh-install default set (see
  below), and there is no role holding `*` until a CLI script provisions
  `system:superadmin`. 0801 also always creates a "Sponsor" role (regardless
  of any pre-existing data, since it isn't a template port) plus a
  `sponsor.enterprise_linked`/`sponsor.enterprise_unlinked` `role_grant_rules`
  pair, replacing the sponsor auto-link-grants-access behavior
  (`sponsors/service.ts`'s `addEnterpriseMember`/`removeEnterpriseMember`
  and `identity/routes/invites.ts`'s sponsor-invite acceptance branch, both
  routed through the shared `applyRoleGrantRule` helper in
  `identity/role-grants.ts`). `permission_groups`/`group_capabilities`/
  `permission_group_includes`/`permission_group_members` were dropped once
  the copy landed, in the same change.
- **Sponsor/judge relationship-based access** is unaffected by this rewrite:
  a sponsor rep's portal access and a judge's panel access still come from
  the `sponsors`/`enterprise_judges` relationship tables, resource-bound as
  before (see "Implementation result" below) — the Sponsor role from
  `role_grant_rules` is additive (it exists so a sponsor rep also shows up
  correctly in role-based UI and audit), not a replacement for that
  relationship check.
- **Admin routes**: `identity/routes/roles.ts` (replacing
  `routes/permissions.ts`) exposes role CRUD, tri-state capability editing,
  position reordering, and user assignment — the old capability-group CRUD
  routes (`/api/permission-groups*`) are removed, not deprecated in place.
- Capability groups no longer exist at all, cosmetic or otherwise — the H8
  template catalogue (`templates.ts`) is reused only as a prefill/seed
  source for creating a role, not as a separate authorization concept.

### `system:superadmin` is CLI-only, not just protected

`is_protected` (0800) is informational going forward: every default role
seeded by 0801/0805 is a fully mutable, deletable/restorable role like any
other — the earlier "protected roles can't be deleted" rule is gone. The one role that stays fully locked out of the
HTTP API is `system:superadmin`, identified by **name**
(`role-authority.ts`'s `assertNotSuperadminRole`/`SUPERADMIN_ROLE_NAME`), not
by `is_protected` — `is_protected` may end up describing other default roles
later without granting them this same lockout.

`identity/routes/roles.ts` calls `assertNotSuperadminRole` before every write
that touches an existing role by id (rename, reorder, capability edit, soft
delete, restore, assign/unassign member) and before role creation (to stop an
API caller minting a decoy role under the reserved name). This holds even for
an actor who holds `*` themselves — the check is unconditional, not
capability-gated. Its capability set stays exactly `{'*': allow}` because
nothing can ever change it through the API.

The only way to grant or revoke `system:superadmin` is a server-shell script,
run with direct Postgres access:

- `pnpm --filter @hackos/api superadmin:create` (`scripts/create-superadmin.ts`) —
  create-or-upgrade an account to superadmin.
- `pnpm --filter @hackos/api superadmin:grant` (`scripts/grant-superadmin.mjs`) —
  attach it to an existing account (plain Node ESM, no build step, for
  environments without `tsx`).
- `pnpm --filter @hackos/api superadmin:revoke` (`scripts/revoke-superadmin.mjs`) —
  remove it from an account. Refuses if that would leave zero active
  superadmins, replicating `assertActiveWildcardHolder`'s resolved-tri-state
  query scoped to `system:superadmin`'s `*` grant and excluding the target
  user.

All three insert an `audit_log` row (`grant_superadmin` / `create_superadmin`
/ `revoke_superadmin`) in the same transaction as the `user_roles` write.

### Soft-delete and restore (0804)

`roles.deleted_at` (nullable `timestamptz`) replaces hard `DELETE` for every
role except `system:superadmin` (still fully locked out — see above).
`DELETE /api/roles/:roleId` now sets `deleted_at = now()`; the row, its
`role_capabilities`, its `user_roles` memberships, and every audit entry that
references it survive untouched. A deleted role stops granting access
immediately — `user_effective_capabilities` and every hand-rolled resolution
query in `role-authority.ts` filter `deleted_at IS NULL`, exactly as if the
user held no such role.

`roles_position_idx` became a partial unique index
(`WHERE deleted_at IS NULL`) in the same migration: a deleted role's position
is released for reuse rather than permanently reserved. `POST
/api/roles/:roleId/restore` clears `deleted_at`, keeping the role's original
position — if a still-live role has since taken that exact slot, restore
409s instead of silently picking a new position; the actor moves one of the
two roles via `PATCH .../position` and retries. `GET /api/roles` excludes
deleted roles by default; `?includeDeleted=true` (gated by
`permissions:manage`, same as every mutation) lists them too, powering the
web permissions page's trash panel (`apps/web/src/app/(app)/permissions/page.tsx`).

### Default seeded role set (0805)

A fresh install's only source of default roles is 0805 (0801 ports over
pre-existing template-origin `permission_groups` data on an upgrade, but
creates nothing on a fresh database — see above) plus 0801's always-created
`Sponsor` role and the CLI-only `system:superadmin`. Earlier drafts of this
migration mechanically ported all 20 legacy platform templates as roles
unconditionally, which meant a fresh install ended up with roughly 25 roles
nobody asked for; 0805 is now the deliberate, curated default set instead — a
real hackathon's org chart from planning through operations, kept to four
staff tiers plus the three applicant/relationship markers:

- **Event director** — planning: event identity, venue, programme, and
  outward comms as one role, above any narrower slice-owning role a real
  install may have migrated in from 0801.
- **Judge coordinator** — judging-floor coordination (`judge:panel`,
  `projects:read`) — deliberately narrower than a full judging-admin
  capability set (no `queue:operate`/`queue:admin`/`judging:export`).
- **Operations lead** — day-of decision-maker: logistics visibility
  (`logistics:stats`), the automatic-presence policy (`presence:manage`),
  and queue administration (`queue:admin`) — a genuinely higher tier than
  scan-console staffing, not a near-duplicate of it.
- **Volunteer staff** — lightweight check-in-desk staffing: both entry scans
  (`accredit:scan`, `presence:scan`), no stats/admin visibility. Kept
  separate from Operations lead rather than merged: the two capability sets
  don't overlap at all (admin vs. scan-only), so collapsing them would either
  over-grant volunteers or under-grant the ops lead.
- **Mentor** — applicant-facing granted role (`applications.grants_role_id`
  target) for accepted mentors: read-only project visibility, nothing to
  manage.
- **Participant** — applicant-facing granted role for accepted participants;
  carries no capabilities of its own, same pattern as `Sponsor` — a
  relationship/status marker, not a permission grant.

All six are `is_protected = false` and fully deletable/editable via the
normal roles API. The existing `Sponsor` auto-grant role (0801) is unchanged:
still capability-less, still wired via `role_grant_rules` on enterprise
link/unlink, positioned below every staff-tier role. `Event director`,
`Judge coordinator`, `Mentor`, and `Participant` are referenced by name only
in tests/docs — nothing in `role_grant_rules` or seed data targets them by
name the way `Sponsor` is targeted, so they remain safe to rename later
without a data migration.

## Goal and non-goals (capability-group era — superseded, see above)

Every API route must declare one authoritative access policy, and every
capability or relationship grant must be validated, bounded, immediately
revocable, and testable from that declaration. Administration should also have
safe, resettable permission-group templates without turning templates into
immutable roles.

This work does not replace capability-based authorization with roles, infer
permissions from the UI, auto-assign new templates, remap existing custom
groups, or edit the normative files under `plan/`. Frontend gates remain
usability controls; the API remains authoritative.

> The role-hierarchy rewrite above is the one exception to "does not replace
> capability-based authorization with roles" — it was a deliberate,
> explicitly approved architecture inversion, done via new migrations and a
> `plan/` update rather than an ad hoc edit, so it doesn't contradict the
> spirit of this non-goal (`plan/` still wins on conflict; it was updated,
> not silently overridden).

## Implementation result (capability-group era — superseded, see above)

- Strict startup enforcement records **278 non-HEAD route-policy rows** and
  exactly one logical Better Auth generated-route exemption, yielding **276
  logical declarations**. This is +5 from the 271-route baseline, matching the
  three added permission-template APIs and two scoped wallet-token routes.
- The runtime audit snapshots **15 public** and **12 token** rows, rejects
  malformed policy metadata (including unknown capabilities), and has no broad
  exemption.
- Effective capabilities resolve from PostgreSQL per request; unknown grants
  are quarantined and removed, while the persistent
  `deprecated_sponsor_portal_assignments` report retains the deprecated no-op
  `sponsor:portal` assignments for review.
- Sponsor and judge relationships are resource-bound. In particular, room
  operations require an active assignment to that exact room even when another
  room hosts the same challenge.
- The independent AC-5 gate approved release after the route audit, lint, API
  integration suite (**70 files / 614 tests**), web typecheck and tests
  (**28 files / 179 tests**), and mobile typecheck and tests
  (**15 suites / 68 tests**) passed.

These specific counts predate the role-hierarchy rewrite (the route count,
for instance, changed when `/api/permission-groups*` was replaced by
`/api/roles*` — see the generated ledger for the current numbers).

Run `pnpm --filter @hackos/api route-policy:audit` after route changes, then
review the generated ledger before release. The route-policy tests plus API,
web, and mobile checks in the release section remain the acceptance commands.

## Historical audit baseline

The initial audit recorded:

- 271 Fastify routes across 10 application domains.
- 41 routes without an explicit `preHandler`. Some are intentionally public;
  others perform authentication or relationship checks inside handlers, which
  prevents mechanical verification.
- 32 named capabilities plus the `*` administrator wildcard, nested permission
  groups, and only a development `admin` seed. There are no production-ready
  group presets.
- Permission-group and invitation APIs that can accept arbitrary capability
  strings.
- A privilege-escalation path: a holder of `permissions:manage` can assign a
  group whose effective closure contains `*`, including through invitation
  group assignment.
- Cross-request effective-capability caching with Valkey invalidation and a
  30-second TTL. A failed invalidation therefore leaves a stale-access window
  after a committed revocation.
- Repeated contextual sponsor and judge authorization logic across challenges,
  projects, rooms, judging, and reviews.
- Incomplete decision-only application access: the workflow supports
  `applications:decide`, but discovery metadata and navigation omit it.
- A public operational stream at `GET /api/queue/stream`; TV consumers use it
  even though they only need sanitized invalidations.
- An anonymous mutation at `POST /api/public/universities/propose` that falls
  back to `userId ?? 0`, and `/api/me/wallet/*` routes that rely on
  handler-level authentication.
- `sponsor:portal` assignments even though that capability has no production
  authorization use.

The implementation must regenerate these counts from the final route ledger;
the numbers above are a baseline, not an acceptance target.

## Route policy contract

Add mandatory `RouteAccessPolicy` metadata to every application-owned Fastify
route. The metadata is the route ledger's source, and its policy is enforced by
preHandlers rather than duplicated in handler bodies.

| Kind | Meaning | Required metadata |
| --- | --- | --- |
| `public` | Deliberately anonymous read or health endpoint | A stable reason/category from the anonymous allowlist |
| `token` | Invite, confirmation, Better Auth, or PassKit protocol authorization | Named token/protocol policy |
| `authenticated` | Signed-in self-service operation | No capability; authenticated `userId` required |
| `capability` | Global capability grant | One capability or an explicit `allOf`/`anyOf` set |
| `contextual` | Authentication plus capability and/or relationship scope | Named resource policy and the resource locator it consumes |

Register an `onRoute` assertion that fails application startup and tests if an
application-owned route omits this metadata. Better Auth-generated routes get
one narrow, explicit plugin-level exemption because hackOS does not register
those routes individually. No other module-level or path-prefix exemption is
allowed.

Move existing handler-level authentication and authorization into reusable
preHandlers. Handlers may still validate domain state, but they must not hide
the route's access class from the ledger. Generate a stable, reviewable ledger
containing method, URL, module, policy kind, policy name/capabilities, and
anonymous category. Snapshot the anonymous rows.

### Anonymous allowlist

The only anonymous API surfaces are:

- health checks;
- Better Auth and documented invite/confirmation token flows;
- documented `GET /api/public/*` content and public announcements;
- public TV reads and payload-free TV/content invalidation streams;
- PassKit protocol endpoints authorized by Apple web-service tokens.

University proposals become authenticated mutations. `/api/me/wallet/*` is
explicitly authenticated. Anything not in this allowlist must be
`authenticated`, `capability`, `contextual`, or `token`; there is no implicit
public default.

`GET /api/events/stream` requires authentication plus a required domain topic.
It carries only payload-free `domain.changed` signals for the owning read
model; it is not a global refresh stream. `GET /api/queue/stream` remains an
authenticated operational stream with the appropriate queue/judging
authorization. Public TV clients move to the TV stream, which broadcasts only
payload-free queue/content/public-sponsor change invalidations; clients refetch
their public, sanitized TV projection after an invalidation. No operational queue
payload, room-control detail, account identifier, or private project data may
cross the public stream.

## Authorization resolution

### Effective capabilities

Resolve effective capabilities from PostgreSQL at authorization time. Remove
cross-request capability caching and the authorization dependency on Valkey
invalidation. Memoize the result only on the current request so multiple
preHandlers do not repeat the recursive group query. A capability revocation
must take effect on the first request started after its transaction commits,
even when Valkey is unavailable.

The shared catalogue in
[`packages/shared/src/capabilities.ts`](../packages/shared/src/capabilities.ts)
remains the only source for capability strings. Every direct grant, group
mutation, nesting operation, template reset, member assignment, and invitation
flow validates against `ALL_CAPABILITIES`; route code must use `CAPABILITIES`
constants rather than inline strings.

Before adding the database constraint, a migration preflight moves unknown
existing grants into a quarantine table, records enough provenance to audit and
repair them, and removes them from effective authorization. A test must prove
that the database constraint and `ALL_CAPABILITIES` contain the same catalogue.
Existing `sponsor:portal` grants are reported separately; the capability stays
as a documented no-op during migration compatibility but is excluded from
templates and selectable UI.

### Contextual resource policies

Centralize named policies for:

- enterprise access;
- challenge access;
- room access;
- repository/project access;
- queue-entry access;
- review access;
- export access.

Each resolver starts from an authenticated account, evaluates global
capabilities, then constrains relationship grants to the target resource.
Remove module-local recursive capability SQL and duplicate sponsor/judge scope
queries after callers adopt the shared policies.

H44/H46 relationship rules remain strict:

- A sponsor representative can access only their enterprise and that
  enterprise's challenges and related resources.
- An assigned judge can access only assigned rooms, their challenges,
  repositories, queue entries, and reviews.
- A global capability is global. A contextual relationship never widens to
  unrelated enterprises, challenges, rooms, repositories, entries, or reviews.

Route parameters and loaded resources must be cross-checked in one policy so a
caller cannot authorize against one parent and operate on a child belonging to
another parent.

### Application and dashboard corrections

Treat `applications:decide` as sufficient to discover and open the application
decision surfaces. Application metadata routes, API guards, web navigation,
and page gates must agree. It does not silently grant form management or
response editing beyond the operations that require decision access.

Dashboard and domain-page decisions use effective capabilities plus the
independent `isEnterpriseJudge` and `isSponsorRep` association facts. The derived
single-priority `role` remains available for display and domain-state
presentation only; it must not decide access or hide one association when an
account has both.

## Permission-group safety

Permission graph mutations run in one PostgreSQL transaction and take a shared
advisory transaction lock before reading or changing groups, includes,
memberships, invitations, or wildcard-holder state. The lock serializes cycle
checks and last-administrator checks so two individually valid concurrent
requests cannot violate the graph invariant together.

Only an authenticated account whose effective capabilities already contain
`*` may:

- create or modify a group whose effective closure contains `*`;
- add an include edge that introduces `*`;
- assign that group to a person or invitation;
- instantiate or reset the platform-administrator template;
- remove an assignment, delete a group, anonymize an account, or perform
  another graph mutation that affects wildcard-holder safety.

After every relevant mutation, at least one active account must remain an
effective `*` holder. The check includes indirect/nested grants and applies to
self-removal, member removal, group deletion, include removal, account
deactivation/anonymization, and invitation acceptance where appropriate.
Every sensitive mutation writes before/after data to the unified audit log in
the same transaction (H53).

An account with `permissions:manage` but without `*` can administer ordinary
groups only. It cannot manufacture or transmit superadmin access.

## Resettable permission templates

Templates are an application catalogue, not permanent database groups. An
administrator instantiates an ordinary editable group; multiple groups may
come from the same template, and the administrator chooses a unique localized
name and optional description.

### API

- `GET /api/permission-group-templates`
- `POST /api/permission-group-templates/:templateKey/instantiate`
  - Body: administrator-chosen localized `name` and optional `description`.
  - Creates an editable group with `template_key`.
- `POST /api/permission-groups/:groupId/reset-template`
  - Requires explicit UI confirmation.
  - Restores the template's exact direct capabilities and clears custom
    includes.
  - Preserves members, name, and description.
  - Audits the before/after graph in the same transaction.

Permission-group responses add:

- `templateKey`: the originating template key or `null`;
- `templateDrifted`: whether direct capabilities or includes differ from the
  current template definition.

Reset and drift comparison use the exact capability set and require no includes.
Renaming or editing a description does not create drift. Template labels and
descriptions are trilingual UI message keys (`es`, `gl`, and `en`), never
hardcoded interface copy.

### Predetermined catalogue

| Template | Exact capabilities |
| --- | --- |
| Platform administrator | `*` |
| Access administrator | `users:read`, `users:write`, `permissions:manage`, `invites:manage`, `audit:read` |
| Application builder | `applications:manage` |
| Application reviewer | `applications:review` |
| Application decisions | `applications:review`, `applications:decide` |
| Application supervisor | `applications:manage`, `applications:review`, `applications:decide`, `applications:confirm-override`, `applications:edit-response` |
| Project operator | `projects:read`, `projects:import`, `projects:edit` |
| Queue operator | `projects:read`, `queue:operate`, `judging:export` |
| Judging administrator | `projects:read`, `queue:operate`, `queue:admin`, `judge:panel`, `judging:export` |
| Accreditation station | `accredit:scan` |
| Presence station | `presence:scan` |
| Activity and meal station | `activity:scan` |
| Logistics supervisor | `accredit:scan`, `presence:scan`, `activity:scan`, `logistics:stats` |
| Programme manager | `schedule:manage` |
| TV operator | `tv:control` |
| Sponsor administrator | `sponsors:manage`, `invites:manage`, `users:read` |
| Communications manager | `announcements:manage`, `notifications:send` |
| Data auditor | `audit:read`, `exports:run`, `users:read` |
| Content-library manager | `intolerances:manage` |

Assigned judges and sponsor representatives need no template for their
relationship-scoped access. `sponsor:portal` is absent from both templates and
the selectable catalogue.

## Orca execution brief

This section is the required execution protocol for the implementation, not a
record that dispatches have already happened. The coordinator must use Orca
orchestration runtime state; ordinary terminal prompts or generic subagents do
not satisfy the provenance requirement.

### Runtime and provenance

Before dispatch:

1. Run `orca status --json` and confirm that orchestration is enabled.
2. Inspect `orca orchestration task-list --json` so existing runtime-global
   tasks are not mistaken for this audit.
3. Create each work item with `orca orchestration task-create --spec ...`
   and encode its dependencies with `--deps`.
4. Create or select a fresh agent terminal in the intended worktree, wait for
   `tui-idle`, then use
   `orca orchestration dispatch --task <task_id> --to <handle> --inject
   --json`.
5. Verify every assignment with
   `orca orchestration dispatch-show --task <task_id> --json`.
6. Supervise with rolling
   `orca orchestration check --wait
   --types worker_done,escalation,decision_gate --timeout-ms <n> --json`.

Workers must report `worker_done` exactly once with their `taskId`,
`dispatchId`, changed files, tests run, route-ledger delta, and unresolved
issues. A terminal looking idle or a wait timing out is not completion
authority. Cross-domain policy disputes are decision gates; a worker must not
invent a local exception.

Shared authorization primitives and migrations have one owner: the policy
foundation worker. Domain workers own disjoint module and client paths. If
workers share the current worktree, the coordinator must state file ownership
in each task spec and prevent overlapping edits. Independent worktrees require
coordinator integration before dependants are dispatched.

### Task DAG

| ID | Task and owner boundary | Depends on | Completion signal |
| --- | --- | --- | --- |
| AC-1 | **Policy foundation:** route metadata/types, `onRoute` enforcement, request-local PostgreSQL capability resolution, shared contextual resolver interfaces, catalogue validation, wildcard/graph transaction protections, and migration preflight | — | Foundation tests pass; migration and route-policy contract documented; `worker_done` |
| AC-2A | **Identity/access:** identity, invitations, permissions, applications, and exports | AC-1 | Domain routes classified; handler checks moved; adversarial tests and ledger rows reported |
| AC-2B | **Projects/sponsors:** projects, challenges, sponsors, enterprise ownership, and contextual resource access | AC-1 | Owned/foreign sponsor and judge probes pass; duplicate scope SQL removed |
| AC-2C | **Judging/realtime:** queue, judging, rooms, reviews, TV, operational SSE, and sanitized public invalidations | AC-1 | Operational streams reject unauthorized clients; public stream snapshot is sanitized |
| AC-2D | **Remaining surfaces:** logistics, event configuration, notifications, wallet protocols, and public endpoints | AC-1 | Anonymous/token allowlist is explicit; university and wallet policies corrected |
| AC-3 | **Templates and clients:** template catalogue/API, instantiate/reset UI, application navigation, association-aware dashboard, and TV/mobile stream consumers | AC-2A, AC-2B, AC-2C, AC-2D | API/UI tests pass; trilingual copy and client stream migrations reported |
| AC-4 | **Consolidation review:** generate final route ledger, reconcile capability docs, run cross-domain/adversarial tests, and open decision gates for inconsistencies | AC-3 | All routes classified; allowlist snapshot and catalogue sync test pass; no unresolved gate |
| AC-5 | **Independent release gate:** a separate review dispatch verifies the DAG/dispatch provenance, migrations, ledger, docs, and required checks | AC-4 | Reviewer `worker_done` states pass or enumerates blocking findings |

AC-2A through AC-2D are the parallel wave. Do not start them until AC-1 has
landed and its shared interfaces are stable. AC-3 integrates their API
contracts into clients. AC-4 owns consolidation fixes only when its dispatch
explicitly grants edit authority; otherwise findings must be routed to the
appropriate domain owner. AC-5 must be a separate review dispatch and cannot
be self-approved by an implementation worker.

### Decision gates

Create a coordinator-managed gate before changing course when:

- a route's public/private classification is not supported by a user story;
- two domains need incompatible semantics from a shared contextual policy;
- existing production data cannot be quarantined without losing provenance;
- preserving the last wildcard holder conflicts with an account lifecycle
  requirement;
- a public client appears to require operational SSE payload fields;
- a migration requires destructive remapping beyond the assumptions below.

Record the resolution in the task result and relevant living documentation.

## Test and acceptance matrix

### Route and policy coverage

- All routes in the regenerated ledger have policy metadata; the final count
  need not remain 271.
- Startup/test registration fails on a missing policy.
- The anonymous allowlist is snapshotted and reviewed.
- Every private route class covers anonymous `401`, authenticated but
  insufficient `403`, authorized success, and wildcard success where wildcard
  is applicable.
- Better Auth's exemption is limited to its generated plugin routes.

### Capability and graph safety

- Grants and committed revocations take effect on the next request with Valkey
  unavailable and under concurrent requests.
- Unknown capabilities are rejected in CRUD, nesting, membership, templates,
  and invitations; the database/shared-catalogue synchronization test passes.
- Existing unknown grants are quarantined and no longer effective.
- A non-wildcard `permissions:manage` holder cannot create, reset, modify,
  include, assign, invite with, or delete through a wildcard-containing graph.
- Concurrent opposite-edge includes cannot create a cycle.
- Concurrent removals cannot eliminate the last active wildcard holder.
- Group deletion, anonymization, and self-removal preserve the same invariant.

### Context and data isolation

- Sponsor representatives succeed on their own enterprise/challenges and fail
  cross-enterprise probes.
- Assigned judges succeed on assigned rooms/challenges/repos/entries/reviews
  and fail unassigned and cross-room probes.
- Parent/child identifier mismatches fail closed.
- Global capability behavior remains global; contextual grants remain scoped.
- Export policies apply the same source-resource scope as their corresponding
  reads.

### Templates and clients

- Instantiate/reset, duplicate-name rejection, drift reporting, preserved
  membership/name/description, cleared includes, audit rows, and administrator
  template restrictions are covered.
- All template UI labels, descriptions, actions, confirmations, and errors
  exist in Spanish, Galician, and English.
- A decision-only account can discover and open its valid application surfaces.
- A judge+sponsor account sees both association-specific dashboard content.
- Operational SSE rejects unauthorized clients.
- Public TV/content streams contain only sanitized invalidations, and web/mobile
  clients refetch the appropriate public projection.
- University proposals and `/api/me/wallet/*` reject anonymous access; PassKit
  protocol routes continue to work with their protocol tokens.

### Release checks

Run from the repository root:

```sh
pnpm lint
pnpm --filter @hackos/api test
pnpm --filter @hackos/web typecheck
pnpm --filter @hackos/web test
```

Also run affected mobile tests and the generated route-policy audit. Update
route schema descriptions and the relevant capability, navigation, module,
mobile, background-worker, and API documentation in the same commits as each
behavior change.

The release gate fails if required checks are skipped without a documented
environmental blocker, if any route lacks policy metadata, if an unresolved
decision gate remains, or if Orca task/dispatch provenance cannot be verified.

## Migration and rollout

1. Inventory and report unknown capability and `sponsor:portal` assignments
   without changing ordinary custom groups or memberships.
2. Add quarantine storage, move unknown grants transactionally, and add the
   catalogue constraint plus synchronization test.
3. Introduce route metadata and enforcement with every existing route
   classified in the same deploy; do not ship a broad temporary exemption.
4. Replace cross-request authorization caching and land graph-safety locking.
5. Land contextual policies domain by domain with parity tests.
6. Separate operational/public SSE and migrate TV/mobile consumers before
   removing public access to the operational stream.
7. Add opt-in templates and clients; do not instantiate or assign them
   automatically.
8. Generate the final ledger, run the release gate, and retain quarantine and
   deprecated-capability reports for administrators.

Rollback must not restore unknown grants to effective authorization or reopen
the operational stream publicly. Schema migrations need a forward repair path;
authorization changes should be feature-sequenced so clients move before old
public behavior is closed.

## Assumptions

- Existing custom groups and memberships stay unchanged unless a grant is
  unknown. Unknown grants are quarantined, not silently mapped.
- Existing `sponsor:portal` assignments are reported, not silently remapped;
  the capability is a temporary no-op until a separately approved removal.
- Templates are opt-in, ordinary editable groups and are never auto-assigned.
- Multiple instances of one template are allowed; group names remain unique.
- Frontend visibility is not authorization.
- Public content is public only through the explicit allowlist.
- `plan/` remains read-only.
