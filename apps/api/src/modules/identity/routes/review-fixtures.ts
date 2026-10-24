import { randomUUID } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../../../config.js";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireCapability } from "../../../lib/capabilities.js";
import { ConflictError, ServiceUnavailableError } from "../../../lib/errors.js";
import { idempotencyGuard } from "../../../lib/idempotency.js";
import { invalidateReviewFixtureCache } from "../../../lib/review-fixture-log.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { reconcileTicketAccess } from "../../logistics/tickets.js";
import { auth } from "../auth.js";
import { purgeReviewFixtureAccount, resetReviewFixtureAccount } from "../removal.js";
import { purgeReviewFixtureQueue } from "../review-fixture-queues.js";
import { assignAttendeeRole } from "../role.js";

/**
 * Synthetic accounts used in the same deployed hackOS instance. The scenario
 * keys and login email addresses are stable. Regeneration resets each account
 * and all of its synthetic state to the default scenario while the generation
 * counter keeps fixture data and operational handoffs auditable.
 */
const FIXTURE_DEFINITIONS = [
  {
    key: "participant-delete",
    kind: "participant" as const,
    name: "App Review",
    surname: "Delete",
  },
  {
    key: "participant-anonymize-outside",
    kind: "participant" as const,
    name: "App Review",
    surname: "Anonymize Outside",
  },
  {
    key: "participant-anonymize-inside",
    kind: "participant" as const,
    name: "App Review",
    surname: "Anonymize Inside",
  },
  { key: "staff-exit-operator", kind: "staff" as const, name: "App Review", surname: "Exit Staff" },
  {
    key: "participant-explorer",
    kind: "participant" as const,
    name: "App Review",
    surname: "Explorer",
  },
  {
    key: "staff-queue-operator",
    kind: "staff" as const,
    name: "App Review",
    surname: "Queue Staff",
  },
] as const;

const FIXTURE_KEYS = FIXTURE_DEFINITIONS.map((fixture) => fixture.key);
const STAFF_CAPABILITIES = [
  CAPABILITIES.ACCREDIT_SCAN,
  CAPABILITIES.PRESENCE_SCAN,
  CAPABILITIES.ACTIVITY_SCAN,
] as const;
/**
 * The queue operator runs the synthetic rooms and judges their projects. Every
 * queue and project route enforces the synthetic boundary for it (see
 * queue/fixture-boundary.ts), so these capabilities reach fixture data only.
 */
const QUEUE_OPERATOR_CAPABILITIES = [
  CAPABILITIES.QUEUE_STATUS,
  CAPABILITIES.QUEUE_OPERATE,
  CAPABILITIES.JUDGE_PANEL,
  CAPABILITIES.PROJECTS_READ,
  CAPABILITIES.PROJECTS_EDIT,
] as const;
const FIXTURE_ROLES = {
  "staff-exit-operator": {
    name: "App review exit staff",
    position: -900000,
    capabilities: STAFF_CAPABILITIES,
  },
  "staff-queue-operator": {
    name: "App review queue staff",
    position: -900001,
    capabilities: QUEUE_OPERATOR_CAPABILITIES,
  },
} as const;

const fixtureAccountSchema = z.object({
  fixtureKey: z.string(),
  kind: z.enum(["participant", "staff"]),
  email: z.string().email(),
});

const fixtureStatusAccountSchema = z.object({
  fixtureKey: z.string(),
  kind: z.enum(["participant", "staff"]),
  email: z.string().email().nullable(),
  active: z.boolean(),
  lastAuthenticatedAt: z.string().nullable(),
  lastAuthenticatedIp: z.string().nullable(),
});

const regenerateResponseSchema = z.object({
  generation: z.number().int().positive(),
  accounts: z.array(fixtureAccountSchema),
  staticDeletionPinConfigured: z.literal(true),
});

const fixtureStatusResponseSchema = z.object({
  generation: z.number().int().nonnegative(),
  accounts: z.array(fixtureStatusAccountSchema),
});

type FixtureRegistryRow = {
  fixture_key: string;
  user_id: number | null;
  generation: number;
};

function requireFixturePassword(): string {
  if (!config.REVIEW_FIXTURE_PASSWORD || !config.REVIEW_FIXTURE_DELETION_PIN) {
    throw new ServiceUnavailableError(
      "Review fixtures are disabled until REVIEW_FIXTURE_PASSWORD and REVIEW_FIXTURE_DELETION_PIN are configured.",
      { code: "review_fixtures_not_configured" },
    );
  }
  return config.REVIEW_FIXTURE_PASSWORD;
}

function fixtureEmail(key: string): string {
  return `app-review-${key}@hackos.test`;
}

async function createFixtureUser(
  client: import("pg").PoolClient,
  fixture: (typeof FIXTURE_DEFINITIONS)[number],
  password: string,
): Promise<{ id: number; email: string }> {
  const email = fixtureEmail(fixture.key);
  const signup = await auth.api.signUpEmail({
    body: {
      email,
      password,
      name: fixture.name,
      surname: fixture.surname,
    },
  });
  const userId = Number(signup.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Review fixture user was not created");
  }

  // The fixture workspace has no mailbox requirement. Mark the synthetic
  // account verified and remove Better Auth's queued verification email; the
  // configured static removal PIN is handled separately by removal-pin.ts.
  await client.query(
    `UPDATE users
        SET email_verified = true,
            is_test_account = true,
            language = 'en'
      WHERE id = $1`,
    [userId],
  );
  await client.query(
    `DELETE FROM notification_outbox
      WHERE user_id = $1 AND category = 'auth' AND payload->>'template' = 'auth.verify'`,
    [userId],
  );
  return { id: userId, email };
}

async function configureFixtureRole(
  client: import("pg").PoolClient,
  role: { name: string; position: number; capabilities: readonly string[] },
): Promise<number> {
  // A low, dedicated position: a synthetic fixture role should never be able to
  // out-rank a real admin/staff role, and nothing else needs to manage it via
  // requireRoleMutationAuthority (fixtures are seeded by an already-wildcard-
  // holding reviewer flow, not through the roles API).
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO roles (name, position, event_access)
     VALUES ($1, $2, true)
     ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position, event_access = true
     RETURNING id`,
    [role.name, role.position],
  );
  const roleId = rows[0]?.id;
  if (!roleId) throw new Error(`Review fixture role ${role.name} was not created`);
  await client.query(`DELETE FROM role_capabilities WHERE role_id = $1`, [roleId]);
  if (role.capabilities.length > 0) {
    await client.query(
      `INSERT INTO role_capabilities (role_id, capability, state)
       SELECT $1::int, capability, 'allow' FROM unnest($2::text[]) AS t(capability)`,
      [roleId, [...role.capabilities]],
    );
  }
  return roleId;
}

async function configureFixtureParticipant(
  client: import("pg").PoolClient,
  userId: number,
  fixtureKey: string,
  generation: number,
  actorId: number,
  staffId: number,
): Promise<void> {
  await assignAttendeeRole(client, userId, "participant", actorId);
  // A used account-claim token is the existing, non-application path that
  // records a manually-created participant's legacy access history.
  await client.query(
    `INSERT INTO email_verification_tokens
       (token, type, email, user_id, kind, expires_at, used_at)
     SELECT $1, 'account_claim', email, id, 'participant', clock_timestamp(), clock_timestamp()
       FROM users WHERE id = $2`,
    [`review-claim-${generation}-${fixtureKey}-${randomUUID()}`, userId],
  );
  await reconcileTicketAccess(client, userId);

  if (fixtureKey === "participant-delete") return;

  const badgeId = `review-${generation}-${fixtureKey}`;
  await client.query(`UPDATE users SET badge_id = $2 WHERE id = $1`, [userId, badgeId]);
  await client.query(
    `INSERT INTO check_in_logs (user_id, badge_id, checked_in_at, check_in_method, staff_id)
     VALUES ($1, $2, clock_timestamp() - interval '1 hour', 'manual', $3)`,
    [userId, badgeId, staffId],
  );

  if (fixtureKey === "participant-anonymize-outside" || fixtureKey === "participant-explorer") {
    await client.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by)
       VALUES
         ($1, 'in', clock_timestamp() - interval '45 minutes', $2),
         ($1, 'out', clock_timestamp() - interval '15 minutes', $2)`,
      [userId, staffId],
    );
  } else {
    await client.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at, scanned_by)
       VALUES ($1, 'in', clock_timestamp() - interval '5 minutes', $2)`,
      [userId, staffId],
    );
  }
}

/** Create the participant-facing synthetic project and judging queue. */
async function configureFixtureQueue(
  client: import("pg").PoolClient,
  userId: number,
  generation: number,
  actorId: number,
): Promise<void> {
  const enterprise = await client.query<{ id: number }>(
    `INSERT INTO enterprises (name) VALUES ($1) RETURNING id`,
    [`Review fixture ${generation}`],
  );
  const enterpriseId = enterprise.rows[0]?.id;
  if (!enterpriseId) throw new Error("Review fixture enterprise was not created");

  const sponsor = await client.query<{ id: number }>(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, NULL) RETURNING id`,
    [enterpriseId],
  );
  const sponsorId = sponsor.rows[0]?.id;
  if (!sponsorId) throw new Error("Review fixture sponsor was not created");

  const challenge = await client.query<{ id: number }>(
    `INSERT INTO challenges (author, title, description, is_test_account, visibility)
     VALUES ($1, $2, $3, true, 'hidden')
     RETURNING id`,
    [sponsorId, "Synthetic judging queue", "Queue data for authorized participant review only."],
  );
  const challengeId = challenge.rows[0]?.id;
  if (!challengeId) throw new Error("Review fixture challenge was not created");

  const repo = await client.query<{ id: number }>(
    `INSERT INTO repos (name, description, created_by, is_test_account)
     VALUES ($1, $2, $3, true)
     RETURNING id`,
    ["Synthetic participant project", "Synthetic queue project for review.", actorId],
  );
  const repoId = repo.rows[0]?.id;
  if (!repoId) throw new Error("Review fixture project was not created");

  await client.query(
    `INSERT INTO submissions (repo_id, user_id, status)
     VALUES ($1, $2, 'active')`,
    [repoId, userId],
  );
  const entry = await client.query<{ id: number }>(
    `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
     VALUES ($1, $2, 'waiting', 1)
     RETURNING id`,
    [challengeId, repoId],
  );
  const queueEntryId = entry.rows[0]?.id;
  if (!queueEntryId) throw new Error("Review fixture queue entry was not created");

  await client.query(
    `INSERT INTO review_fixture_queues
       (fixture_key, enterprise_id, sponsor_id, challenge_id, repo_id, queue_entry_id, generation)
     VALUES ('participant-anonymize-outside', $1, $2, $3, $4, $5, $6)`,
    [enterpriseId, sponsorId, challengeId, repoId, queueEntryId, generation],
  );
}

type FixtureStage = "waiting" | "called" | "in_room" | "presenting" | "completed";

/**
 * The demo graph of `participant-explorer`, a non-destructive account for
 * walking the app, and of the operator that runs it. One synthetic enterprise
 * owns three challenges: *Open* and *Design* share one queue (served by
 * *Review room A*) and *Hardware* has its own (served by *Review room B*).
 * Eight submitted projects, one draft, and a queue entry in every stage:
 * waiting (also in the shared queue), called, inside, presenting and scored.
 * Rooms carry no marker of their own; their scope is inferred from the queue
 * groups they serve, which are synthetic-only, so no real list shows them.
 */
async function configureFixtureExplorer(
  client: import("pg").PoolClient,
  userId: number,
  generation: number,
): Promise<void> {
  const key = "participant-explorer";
  const one = async <T extends { id: number }>(sql: string, params: unknown[], what: string) => {
    const { rows } = await client.query<T>(sql, params);
    const row = rows[0];
    if (!row) throw new Error(`Review explorer ${what} was not created`);
    return row.id;
  };
  const enterpriseId = await one(
    `INSERT INTO enterprises (name) VALUES ($1) RETURNING id`,
    [`Review explorer ${generation}`],
    "enterprise",
  );
  const sponsorId = await one(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, NULL) RETURNING id`,
    [enterpriseId],
    "sponsor",
  );
  const challenge = (title: string, description: string) =>
    one(
      `INSERT INTO challenges (author, title, description, is_test_account, visibility)
       VALUES ($1, $2, $3, true, 'visible') RETURNING id`,
      [sponsorId, title, description],
      `challenge ${title}`,
    );
  const openChallenge = await challenge("Open challenge (review)", "A synthetic open challenge.");
  const designChallenge = await challenge(
    "Design challenge (review)",
    "A synthetic challenge that shares its queue with the open challenge.",
  );
  const hardwareChallenge = await challenge(
    "Hardware challenge (review)",
    "A synthetic challenge with its own queue.",
  );

  // Every challenge starts in its own 1:1 queue group. Open and Design share one.
  const groupOf = async (challengeId: number) =>
    one<{ id: number }>(
      `SELECT queue_group_id AS id FROM queue_group_challenges WHERE challenge_id = $1`,
      [challengeId],
      "queue group",
    );
  const sharedGroup = await groupOf(openChallenge);
  const designGroup = await groupOf(designChallenge);
  const hardwareGroup = await groupOf(hardwareChallenge);
  await client.query(
    `UPDATE queue_group_challenges SET queue_group_id = $1 WHERE challenge_id = $2`,
    [sharedGroup, designChallenge],
  );
  await client.query(`DELETE FROM queue_groups WHERE id = $1`, [designGroup]);
  await client.query(`UPDATE queue_groups SET display_name = $2 WHERE id = $1`, [
    sharedGroup,
    "Open and design (shared queue)",
  ]);

  const room = async (name: string, location: string, groupId: number) => {
    const roomId = await one(
      `INSERT INTO rooms (name, location) VALUES ($1, $2) RETURNING id`,
      [name, location],
      `room ${name}`,
    );
    await client.query(`INSERT INTO room_enterprises (room_id, enterprise_id) VALUES ($1, $2)`, [
      roomId,
      enterpriseId,
    ]);
    await client.query(`INSERT INTO room_queue_groups (room_id, queue_group_id) VALUES ($1, $2)`, [
      roomId,
      groupId,
    ]);
    await client.query(
      `INSERT INTO room_queue_state (room_id, is_paused, started_at)
       VALUES ($1, false, clock_timestamp() - interval '1 hour')`,
      [roomId],
    );
    return roomId;
  };
  const roomA = await room("Review room A", "Ground floor (review)", sharedGroup);
  const roomB = await room("Review room B", "First floor (review)", hardwareGroup);

  const project = async (
    name: string,
    description: string,
    status: "submitted" | "draft",
    options: { githubUrl?: string; member: boolean; challenge?: number },
  ): Promise<number> => {
    const repoId = await one(
      `INSERT INTO repos
         (name, description, github_url, created_by, is_test_account, submission_status,
          submitted_at)
       VALUES ($1, $2, $3, $4, true, $5, CASE WHEN $5 = 'submitted' THEN now() END)
       RETURNING id`,
      [name, description, options.githubUrl ?? null, options.member ? userId : null, status],
      `project ${name}`,
    );
    if (options.member) {
      await client.query(
        `INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`,
        [repoId, userId],
      );
    }
    if (options.challenge !== undefined) {
      await client.query(`INSERT INTO project_challenges (repo_id, challenge_id) VALUES ($1, $2)`, [
        repoId,
        options.challenge,
      ]);
    }
    return repoId;
  };
  const entry = (
    challengeId: number,
    repoId: number,
    stage: FixtureStage,
    options: { position?: number; roomId?: number } = {},
  ) =>
    one(
      `INSERT INTO queue_entries
         (challenge_id, repo_id, status, position, assigned_room_id, call_count, called_at,
          room_entered_at, presentation_started_at, completed_at)
       VALUES ($1, $2, $3::public.queue_status, $4, $5,
         CASE WHEN $6::text IN ('called', 'in_room', 'presenting') THEN 1 ELSE 0 END,
         CASE WHEN $6::text IN ('called', 'in_room', 'presenting')
              THEN clock_timestamp() - interval '12 minutes' END,
         CASE WHEN $6::text IN ('in_room', 'presenting')
              THEN clock_timestamp() - interval '6 minutes' END,
         CASE WHEN $6::text = 'presenting' THEN clock_timestamp() - interval '2 minutes' END,
         CASE WHEN $6::text = 'completed' THEN clock_timestamp() - interval '30 minutes' END)
       RETURNING id`,
      [challengeId, repoId, stage, options.position ?? null, options.roomId ?? null, stage],
      `queue entry ${stage}`,
    );

  const aurora = await project(
    "Aurora Rover",
    "A solar rover that maps a campus. Waiting, in the shared queue of two challenges.",
    "submitted",
    {
      githubUrl: "https://github.com/hackos-review/aurora-rover",
      member: true,
      challenge: openChallenge,
    },
  );
  await client.query(`INSERT INTO project_challenges (repo_id, challenge_id) VALUES ($1, $2)`, [
    aurora,
    designChallenge,
  ]);
  const pixel = await project(
    "Pixel Garden",
    "A plant-care game. Presented and scored.",
    "submitted",
    {
      member: true,
      challenge: openChallenge,
    },
  );
  const nimbus = await project("Nimbus Notes", "Called: wait at the door of room A.", "submitted", {
    member: true,
    challenge: openChallenge,
  });
  const tidal = await project("Tidal Lab", "Inside room A, about to present.", "submitted", {
    member: true,
    challenge: designChallenge,
  });
  const ember = await project("Ember Engine", "Presenting now in room B.", "submitted", {
    member: true,
    challenge: hardwareChallenge,
  });
  const draft = await project("Draft Notes", "A project still being written.", "draft", {
    member: true,
  });
  const lumen = await project(
    "Lumen Labs",
    "Another team, waiting in the shared queue.",
    "submitted",
    {
      member: false,
      challenge: openChallenge,
    },
  );
  const orbit = await project(
    "Orbit Kit",
    "Another team, waiting in the shared queue.",
    "submitted",
    {
      member: false,
      challenge: openChallenge,
    },
  );

  const entries = {
    lumen: await entry(openChallenge, lumen, "waiting", { position: 1 }),
    orbit: await entry(openChallenge, orbit, "waiting", { position: 2 }),
    aurora: await entry(openChallenge, aurora, "waiting", { position: 3 }),
    auroraDesign: await entry(designChallenge, aurora, "waiting", { position: 4 }),
    pixel: await entry(openChallenge, pixel, "completed"),
    nimbus: await entry(openChallenge, nimbus, "called", { roomId: roomA }),
    tidal: await entry(designChallenge, tidal, "in_room", { roomId: roomA }),
    ember: await entry(hardwareChallenge, ember, "presenting", { roomId: roomB }),
  };

  type Pointer = {
    slot: string;
    shared?: boolean;
    challengeId?: number;
    repoId?: number;
    entryId?: number;
    roomId?: number;
  };
  const pointers: Pointer[] = [
    {
      slot: "main",
      shared: true,
      challengeId: openChallenge,
      repoId: aurora,
      entryId: entries.aurora,
    },
    { slot: "challenge-design", challengeId: designChallenge, entryId: entries.auroraDesign },
    { slot: "challenge-hardware", challengeId: hardwareChallenge },
    { slot: "room-a", roomId: roomA },
    { slot: "room-b", roomId: roomB },
    { slot: "pixel", repoId: pixel, entryId: entries.pixel },
    { slot: "nimbus", repoId: nimbus, entryId: entries.nimbus },
    { slot: "tidal", repoId: tidal, entryId: entries.tidal },
    { slot: "ember", repoId: ember, entryId: entries.ember },
    { slot: "draft", repoId: draft },
    { slot: "team-lumen", repoId: lumen, entryId: entries.lumen },
    { slot: "team-orbit", repoId: orbit, entryId: entries.orbit },
  ];
  await client.query(
    `INSERT INTO review_fixture_queues
       (fixture_key, slot, enterprise_id, sponsor_id, challenge_id, repo_id, queue_entry_id,
        room_id, generation)
     SELECT $1::text, t.slot, t.enterprise_id, t.sponsor_id, t.challenge_id, t.repo_id, t.queue_entry_id,
            t.room_id, $9::int
       FROM unnest($2::text[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[])
            AS t(slot, enterprise_id, sponsor_id, challenge_id, repo_id, queue_entry_id, room_id)`,
    [
      key,
      pointers.map((pointer) => pointer.slot),
      pointers.map((pointer) => (pointer.shared ? enterpriseId : null)),
      pointers.map((pointer) => (pointer.shared ? sponsorId : null)),
      pointers.map((pointer) => pointer.challengeId ?? null),
      pointers.map((pointer) => pointer.repoId ?? null),
      pointers.map((pointer) => pointer.entryId ?? null),
      pointers.map((pointer) => pointer.roomId ?? null),
      generation,
    ],
  );
}

async function cleanupFailedFixtureUsers(userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await withTransaction(async (client) => {
      // The creation transaction may have rolled back the marker update while
      // Better Auth's user insert was already committed on its own connection.
      // These ids are captured only from the just-failed signup calls, so
      // marking them synthetic is safe and lets the normal scrub run.
      await client.query(`UPDATE users SET is_test_account = true WHERE id = ANY($1::int[])`, [
        userIds,
      ]);
      for (const userId of userIds) {
        const { rows } = await client.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
        if (rows[0]) await purgeReviewFixtureAccount(client, userId);
      }
    });
  } catch {
    // Preserve the original provisioning error. A later regeneration retries
    // the same synthetic rows before creating credentials; real users cannot
    // enter this cleanup path.
  }
}

/** Register the admin-only App Store/QA fixture regeneration endpoint. */
export function registerReviewFixtureRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    "/api/admin/review-fixtures/regenerate",
    {
      preHandler: [requireCapability(CAPABILITIES.ADMIN_ALL), idempotencyGuard],
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.ADMIN_ALL }),
      schema: {
        summary: "Regenerate App Store review fixtures",
        description:
          "Resets the synthetic deletion/anonymization participant accounts and scanner operator to their default scenarios while keeping their login email addresses stable. Requires both deployment-only fixture secrets; real accounts are never created by this route and fixture users are excluded from aggregate statistics.",
        response: { 200: regenerateResponseSchema },
      },
    },
    async (req) => {
      const password = requireFixturePassword();
      const createdUserIds: number[] = [];
      try {
        const result = await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO review_fixture_accounts (fixture_key)
             SELECT fixture_key FROM unnest($1::text[]) AS values(fixture_key)
             ON CONFLICT (fixture_key) DO NOTHING`,
            [FIXTURE_KEYS],
          );
          const { rows: registry } = await client.query<FixtureRegistryRow>(
            `SELECT fixture_key, user_id, generation
               FROM review_fixture_accounts
              WHERE fixture_key = ANY($1::text[])
              ORDER BY fixture_key
              FOR UPDATE`,
            [FIXTURE_KEYS],
          );
          const generation = Math.max(0, ...registry.map((row) => Number(row.generation) || 0)) + 1;

          // A failed Better Auth signup can leave a committed synthetic user
          // after the surrounding transaction rolls back. Reuse those exact
          // stable login addresses when they are available; deleting a stable
          // row and signing up again inside this transaction would not work,
          // because Better Auth writes through a separate database connection.
          const candidateEmails = FIXTURE_DEFINITIONS.map((fixture) => fixtureEmail(fixture.key));
          const { rows: stableUsers } = await client.query<{
            id: number;
            email: string;
            is_test_account: boolean;
          }>(
            `SELECT id, email, is_test_account
               FROM users
              WHERE lower(email) = ANY($1::text[])
              ORDER BY id
              FOR UPDATE`,
            [candidateEmails.map((email) => email.toLowerCase())],
          );

          const registeredUserIds = [
            ...new Set(
              registry
                .map((row) => row.user_id)
                .filter((userId): userId is number => userId !== null),
            ),
          ];
          const { rows: registeredUsers } =
            registeredUserIds.length > 0
              ? await client.query<{ id: number; email: string; is_test_account: boolean }>(
                  `SELECT id, email, is_test_account
                     FROM users
                    WHERE id = ANY($1::int[])
                    ORDER BY array_position($1::int[], id)
                    FOR UPDATE`,
                  [registeredUserIds],
                )
              : { rows: [] as Array<{ id: number; email: string; is_test_account: boolean }> };

          const registryByKey = new Map(registry.map((row) => [row.fixture_key, row]));
          const registryByUserId = new Map(
            registry
              .filter((row) => row.user_id !== null)
              .map((row) => [row.user_id as number, row.fixture_key]),
          );
          const stableByEmail = new Map(stableUsers.map((row) => [row.email.toLowerCase(), row]));
          const registeredById = new Map(registeredUsers.map((row) => [row.id, row]));
          const existingByFixture = new Map<string, { id: number; email: string }>();
          const staleStableUsers: typeof stableUsers = [];
          for (const fixture of FIXTURE_DEFINITIONS) {
            const registered = registryByKey.get(fixture.key);
            const stable = stableByEmail.get(fixtureEmail(fixture.key).toLowerCase());
            if (stable && !stable.is_test_account) {
              throw new ConflictError("A real account owns a reserved review fixture login.", {
                code: "review_fixture_email_reserved",
                email: stable.email,
              });
            }
            const stableOwner = stable ? registryByUserId.get(stable.id) : undefined;
            if (stableOwner && stableOwner !== fixture.key) {
              throw new ConflictError("Review fixture registry has conflicting login ownership.", {
                code: "review_fixture_registry_conflict",
                fixtureKey: fixture.key,
              });
            }
            if (registered?.user_id !== null && registered?.user_id !== undefined) {
              const registeredUser = registeredById.get(registered.user_id);
              if (!registeredUser) {
                throw new Error("Review fixture registry points at a missing account");
              }
              existingByFixture.set(fixture.key, {
                id: registeredUser.id,
                email: registeredUser.email,
              });
              if (stable && stable.id !== registered.user_id) staleStableUsers.push(stable);
            } else if (stable) {
              existingByFixture.set(fixture.key, { id: stable.id, email: stable.email });
            }
          }

          // Purge orphaned stable rows before resetting current rows, and do
          // operator provenance first for the same H54 trigger invariant.
          staleStableUsers.sort((left, right) => {
            const leftFixture = FIXTURE_DEFINITIONS.find(
              (fixture) => fixtureEmail(fixture.key).toLowerCase() === left.email.toLowerCase(),
            );
            const rightFixture = FIXTURE_DEFINITIONS.find(
              (fixture) => fixtureEmail(fixture.key).toLowerCase() === right.email.toLowerCase(),
            );
            return (
              Number(rightFixture?.kind === "staff") - Number(leftFixture?.kind === "staff") ||
              left.id - right.id
            );
          });
          for (const row of staleStableUsers) await purgeReviewFixtureAccount(client, row.id);

          const resetOrder = FIXTURE_DEFINITIONS.slice().sort(
            (left, right) => Number(right.kind === "staff") - Number(left.kind === "staff"),
          );
          const created = new Map<string, { id: number; email: string }>();
          for (const fixture of resetOrder) {
            const existing = existingByFixture.get(fixture.key);
            if (!existing) continue;
            await resetReviewFixtureAccount(client, existing.id, {
              email: existing.email,
              name: fixture.name,
              surname: fixture.surname,
              password,
            });
            created.set(fixture.key, existing);
          }

          // Remove the previous synthetic queue/project graph before replacing
          // its participant. This also cleans up the graph when a reviewer
          // used the account's own deletion action before regeneration.
          for (const fixture of FIXTURE_DEFINITIONS) {
            await purgeReviewFixtureQueue(client, fixture.key);
          }

          // Anonymous fixture subjects are synthetic QA state, not audit data
          // to carry into the next reviewer generation.
          await client.query(`DELETE FROM anonymous_participants WHERE is_test_account = true`);

          const roleIds = new Map<string, number>();
          for (const [fixtureKey, role] of Object.entries(FIXTURE_ROLES)) {
            roleIds.set(fixtureKey, await configureFixtureRole(client, role));
          }
          for (const fixture of FIXTURE_DEFINITIONS) {
            if (created.has(fixture.key)) continue;
            const account = await createFixtureUser(client, fixture, password);
            createdUserIds.push(account.id);
            created.set(fixture.key, account);
          }
          for (const [fixtureKey, roleId] of roleIds) {
            const operator = created.get(fixtureKey);
            if (!operator) throw new Error(`Review fixture ${fixtureKey} is missing`);
            await client.query(
              `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)`,
              [operator.id, roleId, req.userId],
            );
            await reconcileTicketAccess(client, operator.id);
          }
          const staff = created.get("staff-exit-operator");
          if (!staff) throw new Error("Review fixture staff account is missing");
          for (const fixture of FIXTURE_DEFINITIONS) {
            if (fixture.kind !== "participant") continue;
            const account = created.get(fixture.key);
            if (!account) throw new Error(`Review fixture ${fixture.key} is missing`);
            await configureFixtureParticipant(
              client,
              account.id,
              fixture.key,
              generation,
              req.userId as number,
              staff.id,
            );
          }
          const queueParticipant = created.get("participant-anonymize-outside");
          if (!queueParticipant) throw new Error("Review queue participant is missing");
          await configureFixtureQueue(
            client,
            queueParticipant.id,
            generation,
            req.userId as number,
          );

          const explorer = created.get("participant-explorer");
          if (!explorer) throw new Error("Review explorer is missing");
          await configureFixtureExplorer(client, explorer.id, generation);

          for (const fixture of FIXTURE_DEFINITIONS) {
            const account = created.get(fixture.key);
            if (!account) throw new Error(`Review fixture ${fixture.key} is missing`);
            await client.query(
              `UPDATE review_fixture_accounts
                  SET user_id = $2, generation = $3,
                      last_authenticated_at = NULL,
                      last_authenticated_ip = NULL,
                      updated_at = clock_timestamp()
                WHERE fixture_key = $1`,
              [fixture.key, account.id, generation],
            );
          }
          await audit(client, {
            actorId: req.userId,
            entityType: "review_fixture_generation",
            entityId: generation,
            action: "regenerated",
            source: "admin",
            after: { fixtureKeys: FIXTURE_KEYS },
          });
          return {
            generation,
            accounts: FIXTURE_DEFINITIONS.map((fixture) => ({
              fixtureKey: fixture.key,
              kind: fixture.kind,
              email: created.get(fixture.key)?.email ?? "",
            })),
            staticDeletionPinConfigured: true as const,
          };
        });
        invalidateReviewFixtureCache();
        return result;
      } catch (error) {
        await cleanupFailedFixtureUsers(createdUserIds);
        throw error;
      }
    },
  );

  api.get(
    "/api/admin/review-fixtures",
    {
      preHandler: requireCapability(CAPABILITIES.ADMIN_ALL),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.ADMIN_ALL }),
      schema: {
        summary: "Read synthetic reviewer fixture status",
        description:
          "Returns only the current synthetic fixture scenario, generation, current email address, availability and the most recent successful sign-in time with its trusted request IP. It never returns passwords, PINs, user ids, user agents or participant response values.",
        response: { 200: fixtureStatusResponseSchema },
      },
    },
    async () => {
      const { rows } = await pool.query<{
        fixture_key: string;
        user_id: number | null;
        generation: number;
        email: string | null;
        last_authenticated_at: Date | null;
        last_authenticated_ip: string | null;
      }>(
        `SELECT fixture.fixture_key, fixture.user_id, fixture.generation,
                account.email, fixture.last_authenticated_at,
                fixture.last_authenticated_ip
           FROM review_fixture_accounts fixture
           LEFT JOIN users account ON account.id = fixture.user_id
          ORDER BY fixture.fixture_key`,
      );
      const kindByKey = new Map<string, "participant" | "staff">(
        FIXTURE_DEFINITIONS.map((fixture) => [fixture.key, fixture.kind]),
      );
      return {
        generation: Math.max(0, ...rows.map((row) => Number(row.generation) || 0)),
        accounts: rows.map((row) => ({
          fixtureKey: row.fixture_key,
          kind: kindByKey.get(row.fixture_key) ?? "participant",
          email: row.email,
          active: row.user_id !== null,
          lastAuthenticatedAt:
            row.user_id !== null ? (row.last_authenticated_at?.toISOString() ?? null) : null,
          lastAuthenticatedIp: row.user_id !== null ? row.last_authenticated_ip : null,
        })),
      };
    },
  );
}
