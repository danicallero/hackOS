import { pool } from "../../src/db/pool.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
} from "../queue/fixtures.js";

/** Live Activity suite fixtures (#966). Direct SQL, like the queue/logistics suites. */

export async function openJudgingWindow(): Promise<void> {
  await pool.query(
    `UPDATE queue_settings
        SET schedule_start_at = now() - interval '1 hour',
            schedule_end_at = now() + interval '3 hours'
      WHERE id = 1`,
  );
}

export async function closeJudgingWindow(): Promise<void> {
  await pool.query(
    `UPDATE queue_settings
        SET schedule_start_at = now() - interval '4 hours',
            schedule_end_at = now() - interval '1 hour'
      WHERE id = 1`,
  );
}

export async function resetJudgingWindow(): Promise<void> {
  await pool.query(
    `UPDATE queue_settings SET schedule_start_at = NULL, schedule_end_at = NULL WHERE id = 1`,
  );
}

/** A scannable activity linked to a schedule row starting `startsInMinutes` from now. */
export async function createScannableActivity(
  options: Partial<{
    name: string;
    nameI18n: Record<string, string>;
    category: string;
    requiresScan: boolean;
    location: string | null;
    startsInMinutes: number;
    durationMinutes: number;
  }> = {},
): Promise<number> {
  const startsIn = options.startsInMinutes ?? 10;
  const duration = options.durationMinutes ?? 60;
  const { rows: scheduleRows } = await pool.query<{ id: number }>(
    `INSERT INTO schedule (title, location, type, starts_at, ends_at, requires_scan)
     VALUES ($1, $2, $3,
             now() + make_interval(mins => $4),
             now() + make_interval(mins => $5),
             $6)
     RETURNING id`,
    [
      options.name ?? "Lunch",
      options.location === undefined ? "Hall A" : options.location,
      options.category ?? "meal",
      startsIn,
      startsIn + duration,
      options.requiresScan ?? false,
    ],
  );
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO activities (name, name_i18n, category, requires_scan, schedule_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      options.name ?? "Lunch",
      options.nameI18n ? JSON.stringify(options.nameI18n) : null,
      options.category ?? "meal",
      options.requiresScan ?? false,
      scheduleRows[0]!.id,
    ],
  );
  return rows[0]!.id;
}

export async function logScan(activityId: number, userId: number): Promise<void> {
  await pool.query(`INSERT INTO activity_logs (user_id, activity_id) VALUES ($1, $2)`, [
    userId,
    activityId,
  ]);
}

/** A participant waiting in one queue served by one room. */
export async function participantInQueue(
  options: Partial<{ userId: number; position: number; title: string; roomName: string }> = {},
): Promise<{ userId: number; entryId: number; challengeId: number; roomId: number }> {
  const challengeId = await createChallenge({ title: options.title ?? "Robotics" });
  const roomId = await createRoom({ name: options.roomName ?? "Room B" });
  await pool.query(`UPDATE rooms SET location = 'Floor 2' WHERE id = $1`, [roomId]);
  await assignChallengeToRoom(roomId, challengeId);
  const { repoId, memberIds } = await createRepoWithTeam(
    options.userId !== undefined ? [options.userId] : undefined,
  );
  // Teams ahead so the participant's own rank is `position`.
  for (let i = 1; i < (options.position ?? 1); i += 1) {
    const { repoId: otherRepo } = await createRepoWithTeam();
    await enqueueRepo(challengeId, otherRepo, i);
  }
  const entryId = await enqueueRepo(challengeId, repoId, options.position ?? 1);
  return { userId: memberIds[0]!, entryId, challengeId, roomId };
}

export async function callEntry(entryId: number, roomId: number): Promise<void> {
  await pool.query(
    `UPDATE queue_entries SET status = 'called', called_at = now(), assigned_room_id = $2
      WHERE id = $1`,
    [entryId, roomId],
  );
}

export async function registerDevice(
  userId: number,
  options: Partial<{
    deviceId: string;
    platform: "ios" | "android";
    pushToStartToken: string | null;
    expoPushToken: string | null;
    language: string | null;
    enabled: boolean;
  }> = {},
): Promise<{ id: number; deviceId: string }> {
  const platform = options.platform ?? "ios";
  const deviceId = options.deviceId ?? `device-${crypto.randomUUID()}`;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO live_activity_devices
       (user_id, device_id, platform, push_to_start_token, expo_push_token, language, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      userId,
      deviceId,
      platform,
      options.pushToStartToken === undefined
        ? platform === "ios"
          ? `pts-${deviceId}`
          : null
        : options.pushToStartToken,
      options.expoPushToken === undefined
        ? platform === "android"
          ? `ExponentPushToken[${deviceId}]`
          : null
        : options.expoPushToken,
      options.language ?? null,
      options.enabled ?? true,
    ],
  );
  return { id: rows[0]!.id, deviceId };
}

export async function sessionsOf(deviceRowId: number) {
  const { rows } = await pool.query(
    `SELECT * FROM live_activity_sessions WHERE device_id = $1 ORDER BY id`,
    [deviceRowId],
  );
  return rows;
}

const DEFAULT_KIND_ORDER = [
  "activity",
  "attendee_activity",
  "queue",
  "accreditation",
  "deadline",
] as const;

/**
 * truncateAll wipes 0605's seeded configuration and roles. Recreate it the
 * permissive way for tests about a kind's own gates: every kind enabled in
 * the default order, one role (without event access, so it changes no other
 * fact) allowed for every kind and held by every user existing now.
 */
export async function allowLiveActivities(
  options: Partial<{ maxConcurrent: number; kinds: readonly string[] }> = {},
): Promise<number> {
  await pool.query(
    `INSERT INTO live_activity_settings (id, max_concurrent) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET max_concurrent = EXCLUDED.max_concurrent`,
    [options.maxConcurrent ?? 5],
  );
  const order = options.kinds ?? DEFAULT_KIND_ORDER;
  await pool.query(`DELETE FROM live_activity_kind_settings`);
  for (const [priority, kind] of order.entries()) {
    await pool.query(
      `INSERT INTO live_activity_kind_settings (kind, enabled, priority) VALUES ($1, true, $2)`,
      [kind, priority],
    );
  }
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM roles WHERE name = 'live-activity-test-audience'`,
  );
  let roleId = rows[0]?.id;
  if (roleId === undefined) {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO roles (name, position, is_visible, event_access)
       VALUES ('live-activity-test-audience', 999999999, false, false) RETURNING id`,
    );
    roleId = inserted.rows[0]!.id;
  }
  await pool.query(
    `INSERT INTO live_activity_kind_roles (kind, role_id) SELECT kind, $1 FROM live_activity_kind_settings
     ON CONFLICT DO NOTHING`,
    [roleId],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT id, $1 FROM users ON CONFLICT DO NOTHING`,
    [roleId],
  );
  return roleId;
}
