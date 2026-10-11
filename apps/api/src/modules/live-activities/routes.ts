import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { Language } from "@hackos/shared/locale";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "../../db/pool.js";
import {
  getRequestAuthorizationContext,
  requireAuth,
  requireCapability,
  userHasCapability,
} from "../../lib/capabilities.js";
import { NotFoundError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessOption as routeAccess } from "../../lib/route-policy.js";
import { normalizeLanguage } from "../notifications/templates.js";
import {
  deviceResponseSchema,
  endSessionBodySchema,
  liveActivitySettingsSchema,
  myLiveActivitiesQuerySchema,
  myLiveActivitiesResponseSchema,
  putLiveActivitySettingsBodySchema,
  statusResponseSchema,
  upsertDeviceBodySchema,
  upsertSessionBodySchema,
} from "./schemas.js";
import { readLiveActivitySettings, saveLiveActivitySettings } from "./settings.js";
import { myLiveActivities } from "./state.js";

/**
 * Live Activity device/session registry and read model (#966; H38, H25,
 * H26). Same access posture as `POST /api/me/push-tokens`: any signed-in,
 * active account manages its own devices, with no capability and no audit
 * row — this is delivery plumbing, not a domain decision. Every write is an
 * idempotent upsert, so client retries are safe without an idempotency key.
 */

async function lockActiveUser(client: PoolClient, userId: number): Promise<void> {
  const { rows } = await client.query(
    `SELECT id FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("User not found");
}

/** The caller's own device row, locked; a device registered by another account is not found. */
async function ownDeviceId(client: PoolClient, userId: number, deviceId: string): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM live_activity_devices WHERE device_id = $1 AND user_id = $2 FOR UPDATE`,
    [deviceId, userId],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new NotFoundError("Live Activity device not registered");
  return id;
}

export function registerLiveActivityRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.put(
    "/api/me/live-activities/device",
    {
      ...routeAccess({ kind: "authenticated", emailVerification: "none" }),
      preHandler: requireAuth,
      schema: {
        summary: "Register a device for Live Activities",
        description:
          "Upserts this app install (`deviceId`) for Live Activities / Live Updates: the iOS " +
          "push-to-start token, the Expo push token used for Android data pushes, the label " +
          "language and the per-device opt-out (`enabled`). Omitted fields keep their stored " +
          "value; `null` clears a token or the language override. A token is held by one device " +
          "only: registering it here clears it from any other device. A device id registered " +
          "by another account is reassigned to the caller; its ended sessions are dropped and " +
          "the activities still open on it are updated for the caller or ended.",
        body: upsertDeviceBodySchema,
        response: { 200: deviceResponseSchema },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const body = req.body;
      return withTransaction(async (client) => {
        await lockActiveUser(client, userId);
        const { rows: existing } = await client.query<{ id: number; user_id: number }>(
          `SELECT id, user_id FROM live_activity_devices WHERE device_id = $1 FOR UPDATE`,
          [body.deviceId],
        );
        if (existing[0] && existing[0].user_id !== userId) {
          // The previous account's dismissals and finished runs must not
          // gate the new account. Open sessions stay: they are activities
          // still on this phone, and the worker either updates them with the
          // new account's state or ends them; dropping them would orphan them.
          await client.query(
            `DELETE FROM live_activity_sessions WHERE device_id = $1 AND ended_at IS NOT NULL`,
            [existing[0].id],
          );
        }
        // A token addresses one physical install: if another device row
        // (a reinstall with a new deviceId, possibly another account) still
        // holds it, that row would push its own account's activities here.
        if (body.pushToStartToken) {
          await client.query(
            `UPDATE live_activity_devices SET push_to_start_token = NULL
              WHERE push_to_start_token = $1 AND device_id <> $2`,
            [body.pushToStartToken, body.deviceId],
          );
        }
        if (body.expoPushToken) {
          await client.query(
            `UPDATE live_activity_devices SET expo_push_token = NULL
              WHERE expo_push_token = $1 AND device_id <> $2`,
            [body.expoPushToken, body.deviceId],
          );
        }
        const { rows } = await client.query<{
          device_id: string;
          platform: "ios" | "android";
          enabled: boolean;
          language: string | null;
        }>(
          `INSERT INTO live_activity_devices
             (user_id, device_id, platform, push_to_start_token, expo_push_token, language, enabled)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true))
           ON CONFLICT (device_id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             platform = EXCLUDED.platform,
             push_to_start_token = CASE WHEN $8 THEN EXCLUDED.push_to_start_token
                                        ELSE live_activity_devices.push_to_start_token END,
             expo_push_token = CASE WHEN $9 THEN EXCLUDED.expo_push_token
                                    ELSE live_activity_devices.expo_push_token END,
             language = CASE WHEN $10 THEN EXCLUDED.language
                             ELSE live_activity_devices.language END,
             enabled = COALESCE($7, live_activity_devices.enabled)
           RETURNING device_id, platform, enabled, language`,
          [
            userId,
            body.deviceId,
            body.platform,
            body.pushToStartToken ?? null,
            body.expoPushToken ?? null,
            body.language ?? null,
            body.enabled ?? null,
            body.pushToStartToken !== undefined,
            body.expoPushToken !== undefined,
            body.language !== undefined,
          ],
        );
        const row = rows[0]!;
        return {
          deviceId: row.device_id,
          platform: row.platform,
          enabled: row.enabled,
          language: row.language,
        };
      });
    },
  );

  api.put(
    "/api/me/live-activities/sessions",
    {
      ...routeAccess({ kind: "authenticated", emailVerification: "none" }),
      preHandler: requireAuth,
      schema: {
        summary: "Register a running Live Activity",
        description:
          "Records that the caller's device is showing the Live Activity `kind`/`subject` " +
          "(`judging` for the queue, `activity:<id>` for a staff activity) and stores or " +
          "rotates its iOS per-activity push token so the server can update and end it. Call " +
          "it after a local start, after a remote push-to-start start, and whenever iOS " +
          "rotates the token. Re-registering a dismissed activity reopens it.",
        body: upsertSessionBodySchema,
        response: { 200: statusResponseSchema },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const { deviceId, kind, subject, activityPushToken } = req.body;
      await withTransaction(async (client) => {
        await lockActiveUser(client, userId);
        const id = await ownDeviceId(client, userId, deviceId);
        await client.query(
          `INSERT INTO live_activity_sessions (device_id, kind, subject, activity_push_token)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (device_id, kind, subject) DO UPDATE SET
             activity_push_token = COALESCE(EXCLUDED.activity_push_token,
                                            live_activity_sessions.activity_push_token),
             -- A reopened activity starts from an unknown rendered state, so
             -- the worker resends the current one.
             state_hash = CASE WHEN live_activity_sessions.ended_at IS NULL
                               THEN live_activity_sessions.state_hash END,
             started_at = CASE WHEN live_activity_sessions.ended_at IS NULL
                               THEN live_activity_sessions.started_at ELSE now() END,
             ended_at = NULL,
             end_reason = NULL,
             dismissed_phase = NULL`,
          [id, kind, subject, activityPushToken ?? null],
        );
      });
      return { status: true as const };
    },
  );

  api.delete(
    "/api/me/live-activities/sessions",
    {
      ...routeAccess({ kind: "authenticated", emailVerification: "none" }),
      preHandler: requireAuth,
      schema: {
        summary: "Dismiss a Live Activity",
        description:
          "Marks the Live Activity `kind`/`subject` on the caller's device as dismissed (the " +
          "user swiped it away, or the app ended it locally). The server stops updating it " +
          "and starts it remotely again only once its phase differs from the dismissed one " +
          "(`phase`, else the last phase the server sent), e.g. a waiting queue activity " +
          "comes back when the team is called. A later local start re-registers it.",
        body: endSessionBodySchema,
        response: { 200: statusResponseSchema },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const { deviceId, kind, subject, phase } = req.body;
      await withTransaction(async (client) => {
        await lockActiveUser(client, userId);
        const id = await ownDeviceId(client, userId, deviceId);
        // Without a phase from the client and no state sent yet, the worker
        // records the phase it next computes (worker.ts).
        await client.query(
          `INSERT INTO live_activity_sessions
             (device_id, kind, subject, ended_at, end_reason, dismissed_phase)
           VALUES ($1, $2, $3, now(), 'dismissed', $4)
           ON CONFLICT (device_id, kind, subject) DO UPDATE SET
             activity_push_token = NULL,
             ended_at = COALESCE(live_activity_sessions.ended_at, now()),
             end_reason = 'dismissed',
             dismissed_phase = COALESCE(EXCLUDED.dismissed_phase,
                                        live_activity_sessions.props->>'phase')`,
          [id, kind, subject, phase ?? null],
        );
      });
      return { status: true as const };
    },
  );

  api.get(
    "/api/me/live-activities",
    {
      ...routeAccess({ kind: "authenticated", emailVerification: "none" }),
      preHandler: requireAuth,
      schema: {
        summary: "My Live Activities",
        description:
          "The Live Activity states the caller should be showing right now, built by the same " +
          "code the push worker uses. `queue` is the participant's nearest queue during the " +
          "judging window only (null outside it or with no live entry); the room appears only " +
          "once the team is called. `activities` lists the scannable activities starting " +
          "within the lead time or in progress, for holders of the activity-scan permission " +
          "only. Labels are localized to `language`, else the account language.",
        querystring: myLiveActivitiesQuerySchema,
        response: { 200: myLiveActivitiesResponseSchema },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      let language: Language;
      if (req.query.language) {
        language = req.query.language as Language;
      } else {
        const { rows } = await pool.query<{ language: string | null }>(
          `SELECT language FROM users WHERE id = $1`,
          [userId],
        );
        language = normalizeLanguage(rows[0]?.language);
      }
      const canScan = await userHasCapability(
        getRequestAuthorizationContext(req),
        CAPABILITIES.ACTIVITY_SCAN,
      );
      return myLiveActivities(userId, language, canScan);
    },
  );

  // Organizer configuration (#966; H8, H53): the event-settings capability
  // that owns event identity and timing also owns these event-wide surfaces.
  const settingsAccess = {
    ...routeAccess({ kind: "capability", capability: CAPABILITIES.EVENT_MANAGE }),
  };

  api.get(
    "/api/live-activities/settings",
    {
      ...settingsAccess,
      preHandler: requireCapability(CAPABILITIES.EVENT_MANAGE),
      schema: {
        summary: "Live Activity configuration",
        description:
          "Organizer configuration of Live Activity kinds (`activity` staff meals/activities, " +
          "`attendee_activity`, `queue`, `deadline`, `judging`, `accreditation`): whether each " +
          "is on, its priority (`kinds` is sorted by it, 0 = highest), the role ids allowed to " +
          "receive it, and the capability it still requires on top of the role " +
          "(`requiredCapability`, null when only data gates it, e.g. a queue entry or a judging " +
          "room). `maxConcurrent` is the most Live Activities one device shows at once; lower " +
          "priority candidates beyond it are not started. `roles` lists every assignable " +
          "(non-deleted) role, highest position first, with the same raw name `GET /api/roles` " +
          "returns, so the editor needs no roles-manager permission.",
        response: { 200: liveActivitySettingsSchema },
      },
    },
    async () => readLiveActivitySettings(),
  );

  api.put(
    "/api/live-activities/settings",
    {
      ...settingsAccess,
      preHandler: [requireCapability(CAPABILITIES.EVENT_MANAGE), idempotencyGuard],
      schema: {
        summary: "Save the Live Activity configuration",
        description:
          "Replaces the whole configuration. `kinds` must list every kind exactly once; its " +
          "array order is the priority (first = highest). `roleIds` replaces the kind's role " +
          "list (unknown or deleted roles are a 400); an empty list means nobody receives it. " +
          "Roles created later are not added to any kind automatically. `maxConcurrent` is " +
          "1–5. Audited; returns the saved configuration. Running Live Activities follow on the " +
          "worker's next tick (ended when no longer allowed, or outranked when a higher-priority " +
          "one starts).",
        body: putLiveActivitySettingsBodySchema,
        response: { 200: liveActivitySettingsSchema },
      },
    },
    async (req) => saveLiveActivitySettings(req.userId as number, req.body),
  );
}
