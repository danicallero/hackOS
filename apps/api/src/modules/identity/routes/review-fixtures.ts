import { randomUUID } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../../../config.js";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireCapability } from "../../../lib/capabilities.js";
import { ServiceUnavailableError } from "../../../lib/errors.js";
import { idempotencyGuard } from "../../../lib/idempotency.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { issueTicket } from "../../logistics/tickets.js";
import { auth } from "../auth.js";
import { purgeReviewFixtureAccount } from "../removal.js";
import { purgeReviewFixtureQueue } from "../review-fixture-queues.js";

/**
 * Synthetic accounts used in the isolated App Store/QA environment. The
 * scenario keys are stable, while the generation suffix makes every account
 * replacement a fresh credential set and prevents old review notes from
 * accidentally pointing at a newly-created person.
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
] as const;

const FIXTURE_KEYS = FIXTURE_DEFINITIONS.map((fixture) => fixture.key);
const STAFF_CAPABILITIES = [
  CAPABILITIES.ACCREDIT_SCAN,
  CAPABILITIES.PRESENCE_SCAN,
  CAPABILITIES.ACTIVITY_SCAN,
] as const;

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

function fixtureEmail(key: string, generation: number): string {
  return `app-review-${key}-${generation}@hackos.test`;
}

async function createFixtureUser(
  client: import("pg").PoolClient,
  fixture: (typeof FIXTURE_DEFINITIONS)[number],
  generation: number,
  password: string,
): Promise<{ id: number; email: string }> {
  const email = fixtureEmail(fixture.key, generation);
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

  // The reviewer deployment has no mailbox requirement. Mark the synthetic
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

async function configureFixtureStaffGroup(client: import("pg").PoolClient): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO permission_groups (name, description)
     VALUES ('App review exit staff', 'Synthetic App Store/QA scanner account')
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
  );
  const groupId = rows[0]?.id;
  if (!groupId) throw new Error("Review fixture staff group was not created");
  await client.query(`DELETE FROM group_capabilities WHERE group_id = $1`, [groupId]);
  for (const capability of STAFF_CAPABILITIES) {
    await client.query(`INSERT INTO group_capabilities (group_id, capability) VALUES ($1, $2)`, [
      groupId,
      capability,
    ]);
  }
  return groupId;
}

async function configureFixtureParticipant(
  client: import("pg").PoolClient,
  userId: number,
  fixtureKey: string,
  generation: number,
  actorId: number,
  staffId: number,
): Promise<void> {
  await client.query(
    `INSERT INTO manual_attendee_roles (user_id, role, assigned_by)
     VALUES ($1, 'participant', $2)`,
    [userId, actorId],
  );
  // A used account-claim token is the existing, non-application path that
  // grants a manually-created participant mobile access.
  await client.query(
    `INSERT INTO email_verification_tokens
       (token, type, email, user_id, kind, expires_at, used_at)
     SELECT $1, 'account_claim', email, id, 'participant', clock_timestamp(), clock_timestamp()
       FROM users WHERE id = $2`,
    [`review-claim-${generation}-${fixtureKey}-${randomUUID()}`, userId],
  );
  await issueTicket(client, userId);

  if (fixtureKey === "participant-delete") return;

  const badgeId = `review-${generation}-${fixtureKey}`;
  await client.query(`UPDATE users SET badge_id = $2 WHERE id = $1`, [userId, badgeId]);
  await client.query(
    `INSERT INTO check_in_logs (user_id, badge_id, checked_in_at, check_in_method, staff_id)
     VALUES ($1, $2, clock_timestamp() - interval '1 hour', 'manual', $3)`,
    [userId, badgeId, staffId],
  );

  if (fixtureKey === "participant-anonymize-outside") {
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
    `INSERT INTO repos (name, description, source, created_by, is_test_account)
     VALUES ($1, $2, 'native', $3, true)
     RETURNING id`,
    ["Synthetic participant project", "Synthetic queue project for review.", actorId],
  );
  const repoId = repo.rows[0]?.id;
  if (!repoId) throw new Error("Review fixture project was not created");

  await client.query(
    `INSERT INTO submissions (repo_id, user_id, imported_from, status)
     VALUES ($1, $2, 'manual', 'active')`,
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
          "Replaces the synthetic deletion/anonymization participant accounts and scanner operator. Requires both deployment-only fixture secrets; real accounts are never created by this route and fixture users are excluded from aggregate statistics.",
        response: { 200: regenerateResponseSchema },
      },
    },
    async (req) => {
      const password = requireFixturePassword();
      const createdUserIds: number[] = [];
      try {
        return await withTransaction(async (client) => {
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
          // after the surrounding transaction rolls back. Reclaim the exact
          // candidate emails before reusing this generation.
          const candidateEmails = FIXTURE_DEFINITIONS.map((fixture) =>
            fixtureEmail(fixture.key, generation),
          );
          const { rows: stale } = await client.query<{ id: number }>(
            `SELECT id FROM users
              WHERE is_test_account = true AND email = ANY($1::text[])
              FOR UPDATE`,
            [candidateEmails],
          );
          for (const row of stale) await purgeReviewFixtureAccount(client, row.id);

          const oldUserIds = [
            ...new Set(
              registry
                .map((row) => row.user_id)
                .filter((userId): userId is number => userId !== null),
            ),
          ];
          if (oldUserIds.length > 0) {
            const { rows: oldUsers } = await client.query<{ id: number; is_test_account: boolean }>(
              `SELECT id, is_test_account FROM users WHERE id = ANY($1::int[]) FOR UPDATE`,
              [oldUserIds],
            );
            for (const row of oldUsers) {
              if (!row.is_test_account) {
                throw new Error("Review fixture registry points at a real account");
              }
              await purgeReviewFixtureAccount(client, row.id);
            }
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

          const staffGroupId = await configureFixtureStaffGroup(client);
          const created = new Map<string, { id: number; email: string }>();
          for (const fixture of FIXTURE_DEFINITIONS) {
            const account = await createFixtureUser(client, fixture, generation, password);
            createdUserIds.push(account.id);
            created.set(fixture.key, account);
          }
          const staff = created.get("staff-exit-operator");
          if (!staff) throw new Error("Review fixture staff account is missing");
          await client.query(
            `INSERT INTO permission_group_members (user_id, group_id, assigned_by)
             VALUES ($1, $2, $3)`,
            [staff.id, staffGroupId, req.userId],
          );
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

          for (const fixture of FIXTURE_DEFINITIONS) {
            const account = created.get(fixture.key);
            if (!account) throw new Error(`Review fixture ${fixture.key} is missing`);
            await client.query(
              `UPDATE review_fixture_accounts
                  SET user_id = $2, generation = $3,
                      last_authenticated_at = NULL,
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
          "Returns only the current synthetic fixture scenario, generation and last successful sign-in time. It never returns passwords, PINs, user ids or participant response values.",
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
      }>(
        `SELECT fixture.fixture_key, fixture.user_id, fixture.generation,
                account.email, fixture.last_authenticated_at
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
          lastAuthenticatedAt: row.last_authenticated_at?.toISOString() ?? null,
        })),
      };
    },
  );
}
