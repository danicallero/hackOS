import { readFile } from "node:fs/promises";
import { pool } from "../db/pool.js";
import { refreshServiceMemory } from "./container-memory.js";
import {
  containerMemoryCurrentBytes,
  containerMemoryLimitBytes,
  containerMemoryUnlimited,
  notificationOutboxOldestQueuedSeconds,
  notificationOutboxOverdueSeconds,
  notificationOutboxRows,
  operationalCollectionSuccess,
  postgresConnections,
  postgresDatabaseSizeBytes,
  postgresEffectiveCacheSizeBytes,
  postgresMaxConnections,
  postgresSharedBuffersBytes,
  valkeyConnected,
  valkeyConnectedClients,
  valkeyEvictedKeysTotal,
  valkeyKeyspaceHitsTotal,
  valkeyKeyspaceMissesTotal,
  valkeyMaxmemoryBytes,
  valkeyUsedMemoryBytes,
} from "./metrics.js";
import { valkey } from "./valkey.js";

function infoValue(info: string, key: string): number | null {
  const line = info.split("\n").find((candidate) => candidate.startsWith(`${key}:`));
  if (!line) return null;
  const value = Number(line.slice(key.length + 1).trim());
  return Number.isFinite(value) ? value : null;
}

function pgMemoryBytes(setting: string, unit: string | null): number {
  const value = Number(setting);
  if (!Number.isFinite(value)) return 0;
  switch ((unit ?? "").toLowerCase()) {
    case "8kb":
      return value * 8 * 1024;
    case "mb":
      return value * 1024 ** 2;
    case "gb":
      return value * 1024 ** 3;
    case "kb":
      return value * 1024;
    default:
      return value;
  }
}

async function refreshPostgresMetrics(): Promise<void> {
  const [outbox, connections, settings, database] = await Promise.all([
    pool.query<{
      channel: string;
      status: string;
      count: string;
      oldest_queued_seconds: number | null;
      overdue_seconds: number | null;
    }>(
      `SELECT channel, status, count(*)::text AS count,
              EXTRACT(EPOCH FROM (now() - min(created_at))) AS oldest_queued_seconds,
              EXTRACT(EPOCH FROM (now() - min(next_attempt_at))) AS overdue_seconds
         FROM notification_outbox
        GROUP BY channel, status`,
    ),
    pool.query<{ state: string | null; count: string }>(
      `SELECT COALESCE(state, 'unknown') AS state, count(*)::text AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY state`,
    ),
    pool.query<{ name: string; setting: string; unit: string | null }>(
      `SELECT name, setting, unit
         FROM pg_settings
        WHERE name IN ('max_connections', 'shared_buffers', 'effective_cache_size')`,
    ),
    pool.query<{ database: string; size: string }>(
      `SELECT current_database() AS database,
              pg_database_size(current_database())::text AS size`,
    ),
  ]);

  notificationOutboxRows.reset();
  notificationOutboxOldestQueuedSeconds.reset();
  notificationOutboxOverdueSeconds.reset();
  postgresConnections.reset();
  postgresDatabaseSizeBytes.reset();
  for (const channel of ["email", "push", "in_app"]) {
    for (const status of ["queued", "sent", "failed", "superseded"]) {
      notificationOutboxRows.set({ channel, status }, 0);
    }
    notificationOutboxOldestQueuedSeconds.set({ channel }, 0);
    notificationOutboxOverdueSeconds.set({ channel }, 0);
  }
  for (const row of outbox.rows) {
    notificationOutboxRows.set({ channel: row.channel, status: row.status }, Number(row.count));
    if (row.status === "queued" && row.oldest_queued_seconds !== null) {
      notificationOutboxOldestQueuedSeconds.set(
        { channel: row.channel },
        Math.max(0, Number(row.oldest_queued_seconds)),
      );
      notificationOutboxOverdueSeconds.set(
        { channel: row.channel },
        Math.max(0, Number(row.overdue_seconds ?? 0)),
      );
    }
  }
  for (const row of connections.rows) {
    postgresConnections.set({ state: row.state ?? "unknown" }, Number(row.count));
  }
  for (const row of settings.rows) {
    if (row.name === "max_connections") postgresMaxConnections.set(Number(row.setting));
    if (row.name === "shared_buffers") {
      postgresSharedBuffersBytes.set(pgMemoryBytes(row.setting, row.unit));
    }
    if (row.name === "effective_cache_size") {
      postgresEffectiveCacheSizeBytes.set(pgMemoryBytes(row.setting, row.unit));
    }
  }
  const db = database.rows[0];
  if (db) postgresDatabaseSizeBytes.set({ database: db.database }, Number(db.size));
}

async function refreshValkeyMetrics(): Promise<void> {
  valkeyConnected.set(valkey.status === "ready" ? 1 : 0);
  if (valkey.status !== "ready") return;

  const info = await valkey.info("memory", "stats", "clients");
  const values: Array<[string, (value: number) => void]> = [
    ["used_memory", (value) => valkeyUsedMemoryBytes.set(value)],
    ["maxmemory", (value) => valkeyMaxmemoryBytes.set(value)],
    ["evicted_keys", (value) => valkeyEvictedKeysTotal.set(value)],
    ["keyspace_hits", (value) => valkeyKeyspaceHitsTotal.set(value)],
    ["keyspace_misses", (value) => valkeyKeyspaceMissesTotal.set(value)],
    ["connected_clients", (value) => valkeyConnectedClients.set(value)],
  ];
  for (const [key, set] of values) {
    const value = infoValue(info, key);
    if (value !== null) set(value);
  }
}

async function refreshCgroupMetrics(): Promise<void> {
  const read = async (path: string): Promise<string | null> => {
    try {
      return (await readFile(path, "utf8")).trim();
    } catch {
      return null;
    }
  };
  for (const resource of ["memory", "swap"] as const) {
    const prefix = resource === "swap" ? "memory.swap" : "memory";
    const current = await read(`/sys/fs/cgroup/${prefix}.current`);
    const limit = await read(`/sys/fs/cgroup/${prefix}.max`);
    if (current && /^\d+$/.test(current)) {
      containerMemoryCurrentBytes.set({ resource }, Number(current));
    }
    if (limit === "max") {
      containerMemoryLimitBytes.set({ resource }, 0);
      containerMemoryUnlimited.set({ resource }, 1);
    } else if (limit && /^\d+$/.test(limit)) {
      containerMemoryLimitBytes.set({ resource }, Number(limit));
      containerMemoryUnlimited.set({ resource }, 0);
    }
  }
}

/**
 * Refreshes gauges that cannot be observed from process-local state. This is
 * called by the scrape endpoint, not on a timer, so a worker/API replica does
 * not create a permanent polling query or retain stale DB connections.
 */
export async function refreshOperationalMetrics(): Promise<void> {
  const observe = async (dependency: string, refresh: () => Promise<void>) => {
    try {
      await refresh();
      operationalCollectionSuccess.set({ dependency }, 1);
    } catch {
      operationalCollectionSuccess.set({ dependency }, 0);
    }
  };
  await Promise.all([
    observe("postgres", refreshPostgresMetrics),
    observe("valkey", async () => {
      await refreshValkeyMetrics();
      if (valkey.status !== "ready") throw new Error("Valkey not ready");
    }),
    refreshCgroupMetrics(),
    refreshServiceMemory("api"),
  ]);
}
