/**
 * Reproducible event-day load harness for #544.
 *
 * This is deliberately a client-side scenario runner, not a second resource
 * scheduler. It drives the real HTTP/SSE surface and reads the existing
 * admission, lane, SSE and participant-invalidation metrics (H22-H42, H46,
 * H540, #544). The fixture is reset only when `--mode prepare` is selected;
 * the load mode never mutates schema or deployment/resource settings. A real
 * run is allowed only against the internal qualification API in NODE_ENV=test;
 * this keeps x-test-user-id out of the attendee API path (H22-H42, H46, H540,
 * #544).
 *
 * Examples:
 *   pnpm --filter @hackos/api event-day:load -- --mode prepare
 *   pnpm --filter @hackos/api event-day:load -- --mode load
 *   pnpm --filter @hackos/api event-day:load -- --mode smoke
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { cpus } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { SSE_TOPICS } from "@hackos/shared/events";
import pg from "pg";
import { migrate } from "./migrate.js";

type Lane = "P0" | "P1" | "P2" | "P3";
type Mode = "prepare" | "load" | "smoke";

export const QUALIFICATION_DATABASE_NAME = "hackos_event_day_qualification";
const DEFAULT_DATABASE_URL = `postgres://hackos:hackos@localhost:5433/${QUALIFICATION_DATABASE_NAME}`;
const DEFAULT_FIXTURE_PATH = "/private/tmp/hackos-event-day-fixture.json";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUTPUT_PATH = resolve(REPO_ROOT, "docs/big-event-readiness-results.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_DURATION_MS = 10_000;

/** Explicit release budgets. P3 is measured but intentionally not release-gating. */
export const DEFAULT_BUDGETS = {
  P0: { p95LatencyMs: 2_000, maxErrorRate: 0.02 },
  P1: { p95LatencyMs: 2_000, maxErrorRate: 0.02 },
  P2: { p95LatencyMs: 3_000, maxErrorRate: 0.05 },
  P3: { p95LatencyMs: 5_000, maxErrorRate: 1 },
} as const;

export const RELEASE_GATING_LANES = ["P0", "P1", "P2"] as const;

const SAFE_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const SAFE_API_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "api", "qualification-api"]);

interface Fixture {
  schemaVersion: 1;
  generatedAt: string;
  database: { host: string; database: string };
  participants: Array<{ id: number; badgeId: string | null }>;
  operators: number[];
  judges: number[];
  rooms: number[];
  challengeId: number;
  entryIds: number[];
  reviewEntryIds: number[];
  mealActivityId: number;
}

interface Options {
  mode: Mode;
  baseUrl: string;
  databaseUrl: string;
  fixturePath: string;
  outputPath: string;
  participants: number;
  operators: number;
  judges: number;
  tvs: number;
  durationMs: number;
}

interface Sample {
  lane: Lane;
  operation: string;
  status: number;
  latencyMs: number;
  error?: string;
}

interface SseConnection {
  lane: Lane;
  topic: string;
  close(): Promise<void>;
}

interface Metric {
  name: string;
  labels: Record<string, string>;
  value: number;
}

type MetricSnapshot = Map<string, Metric>;

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    if (arg === "--") continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined) i += 1;
    if (!key) continue;
    values.set(key, value ?? "true");
  }
  const mode = (values.get("mode") ?? "load") as Mode;
  if (!["prepare", "load", "smoke"].includes(mode)) {
    throw new Error(`Unknown --mode ${mode}; expected prepare, load or smoke`);
  }
  const numberOption = (key: string, fallback: number): number => {
    const value = Number(values.get(key) ?? fallback);
    if (!Number.isFinite(value) || value < 1) throw new Error(`--${key} must be positive`);
    return Math.floor(value);
  };
  const pathOption = (key: string, fallback: string): string => {
    const value = values.get(key) ?? fallback;
    return isAbsolute(value) ? value : resolve(REPO_ROOT, value);
  };
  return {
    mode,
    baseUrl: values.get("base-url") ?? DEFAULT_BASE_URL,
    databaseUrl: values.get("database-url") ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    fixturePath: pathOption("fixture", DEFAULT_FIXTURE_PATH),
    outputPath: pathOption("output", DEFAULT_OUTPUT_PATH),
    participants: numberOption("participants", 600),
    operators: numberOption("operators", 20),
    judges: numberOption("judges", 20),
    tvs: numberOption("tvs", 4),
    durationMs: numberOption("duration-seconds", DEFAULT_DURATION_MS / 1_000) * 1_000,
  };
}

function databaseDescriptor(databaseUrl: string): { host: string; database: string } {
  const url = new URL(databaseUrl);
  return { host: url.host, database: decodeURIComponent(url.pathname.slice(1)) };
}

export function isDestructiveSafeDatabaseUrl(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      SAFE_DATABASE_HOSTS.has(url.hostname) &&
      databaseDescriptor(databaseUrl).database === QUALIFICATION_DATABASE_NAME
    );
  } catch {
    return false;
  }
}

export function assertDestructiveSafeDatabaseUrl(databaseUrl: string): void {
  if (isDestructiveSafeDatabaseUrl(databaseUrl)) return;
  const { host, database } = (() => {
    try {
      return databaseDescriptor(databaseUrl);
    } catch {
      return { host: "invalid", database: "invalid" };
    }
  })();
  throw new Error(
    `Refusing to reset database '${database}' on '${host}'. ` +
      `Prepare requires the isolated ${QUALIFICATION_DATABASE_NAME} database on localhost, 127.0.0.1, ::1 or the qualification compose service 'postgres'.`,
  );
}

export function assertInternalQualificationApi(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Refusing qualification target '${baseUrl}': invalid URL`);
  }
  if (url.protocol !== "http:" || !SAFE_API_HOSTS.has(url.hostname)) {
    throw new Error(
      `Refusing qualification target '${baseUrl}': use the internal HTTP API host (api or localhost), never public ingress or TLS attendee traffic.`,
    );
  }
  if (url.port && url.port !== "3000") {
    throw new Error(`Refusing qualification target '${baseUrl}': only API port 3000 is allowed.`);
  }
}

function redactedCommand(argv: readonly string[]): string {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--database-url") {
      result.push(arg, "[redacted]");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--database-url=")) {
      result.push("--database-url=[redacted]");
      continue;
    }
    result.push(arg ?? "");
  }
  return result.join(" ");
}

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function resetDatabase(databaseUrl: string): Promise<void> {
  assertDestructiveSafeDatabaseUrl(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
  await migrate(databaseUrl);
}

async function prepareFixture(options: Options): Promise<Fixture> {
  await resetDatabase(options.databaseUrl);
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const participantRows = await client.query<{ id: number }>(
      `INSERT INTO users (email, name, surname, email_verified, language)
       SELECT 'event-day-participant-' || n || '@load.test',
              'Participant ' || n, 'Load', true,
              CASE WHEN n % 3 = 0 THEN 'gl' WHEN n % 3 = 1 THEN 'es' ELSE 'en' END
         FROM generate_series(1, $1::int) AS n
       RETURNING id`,
      [options.participants],
    );
    const participants = participantRows.rows.map((row, index) => ({
      id: Number(row.id),
      // Keep 2/3 pre-accredited for meal scans; the remaining 1/3 exercise
      // concurrent accreditation without contending on the meal badge.
      badgeId:
        index < Math.ceil(options.participants * (2 / 3)) ? `event-day-badge-${row.id}` : null,
    }));
    const participantIds = participants.map((person) => person.id);
    const preAccreditedIds = participants
      .filter((person) => person.badgeId)
      .map((person) => person.id);
    await client.query(
      `INSERT INTO manual_attendee_roles (user_id, role)
       SELECT id, 'participant' FROM users WHERE id = ANY($1::int[])`,
      [participantIds],
    );
    await client.query(
      `INSERT INTO tickets (user_id, token)
       SELECT id, 'event-day-ticket-' || id FROM users WHERE id = ANY($1::int[])`,
      [participantIds],
    );
    await client.query(
      `UPDATE users SET badge_id = 'event-day-badge-' || id WHERE id = ANY($1::int[])`,
      [preAccreditedIds],
    );

    const operatorRows = await client.query<{ id: number }>(
      `INSERT INTO users (email, name, surname, email_verified)
       SELECT 'event-day-operator-' || n || '@load.test', 'Operator ' || n, 'Load', true
         FROM generate_series(1, $1::int) AS n RETURNING id`,
      [options.operators],
    );
    const judgeRows = await client.query<{ id: number }>(
      `INSERT INTO users (email, name, surname, email_verified)
       SELECT 'event-day-judge-' || n || '@load.test', 'Judge ' || n, 'Load', true
         FROM generate_series(1, $1::int) AS n RETURNING id`,
      [options.judges],
    );
    const operators = operatorRows.rows.map((row) => Number(row.id));
    const judges = judgeRows.rows.map((row) => Number(row.id));

    const operatorRole = await client.query<{ id: number }>(
      `INSERT INTO roles (name, position) VALUES ('event-day-load-operators', 700) RETURNING id`,
    );
    const judgeRole = await client.query<{ id: number }>(
      `INSERT INTO roles (name, position) VALUES ('event-day-load-judges', 690) RETURNING id`,
    );
    const operatorRoleId = operatorRole.rows[0]?.id;
    const judgeRoleId = judgeRole.rows[0]?.id;
    if (operatorRoleId === undefined || judgeRoleId === undefined) {
      throw new Error("Load fixture roles were not created");
    }
    const operatorCapabilities = [
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.ACCREDIT_SCAN,
      CAPABILITIES.PRESENCE_SCAN,
      CAPABILITIES.ACTIVITY_SCAN,
    ];
    await client.query(
      `INSERT INTO role_capabilities (role_id, capability, state)
       SELECT $1, unnest($2::text[]), 'allow'`,
      [operatorRoleId, operatorCapabilities],
    );
    await client.query(
      `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, 'allow')`,
      [judgeRoleId, CAPABILITIES.JUDGE_PANEL],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT unnest($1::int[]), $2`,
      [operators, operatorRoleId],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT unnest($1::int[]), $2`,
      [judges, judgeRoleId],
    );

    const enterprise = await client.query<{ id: number }>(
      `INSERT INTO enterprises (name, director_id) VALUES ('Event-day Load Enterprise', $1) RETURNING id`,
      [operators[0]],
    );
    const enterpriseId = enterprise.rows[0]?.id;
    if (enterpriseId === undefined || operators[0] === undefined) {
      throw new Error("Load fixture enterprise was not created");
    }
    const sponsor = await client.query<{ id: number }>(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [enterpriseId, operators[0]],
    );
    const challenge = await client.query<{ id: number }>(
      `INSERT INTO challenges
         (author, title, description, judging_panel_criteria, visibility, max_in_waiting_area)
       VALUES ($1, 'Event-day representative queue', 'Issue #544 representative load fixture', NULL, 'visible', 1000)
       RETURNING id`,
      [sponsor.rows[0]?.id],
    );
    const sponsorId = sponsor.rows[0]?.id;
    const challengeId = challenge.rows[0]?.id;
    if (sponsorId === undefined || challengeId === undefined) {
      throw new Error("Load fixture sponsor/challenge was not created");
    }
    const group = await client.query<{ queue_group_id: number }>(
      `SELECT queue_group_id FROM queue_group_challenges WHERE challenge_id = $1`,
      [challengeId],
    );
    const queueGroupId = group.rows[0]?.queue_group_id;
    if (queueGroupId === undefined) throw new Error("Load fixture queue group was not created");
    await client.query(
      `INSERT INTO enterprise_judges (enterprise_id, user_id, added_by)
       SELECT $1, unnest($2::int[]), $3`,
      [enterpriseId, judges, operators[0]],
    );

    const roomRows = await client.query<{ id: number }>(
      `INSERT INTO rooms (name, slug, status)
       SELECT 'Event-day Room ' || n, 'event-day-room-' || n, 'active'
         FROM generate_series(1, 4) AS n RETURNING id`,
    );
    const rooms = roomRows.rows.map((row) => Number(row.id));
    await client.query(
      `INSERT INTO room_queue_state (room_id, is_paused, max_in_waiting_area, desired_minutes_per_team)
       SELECT unnest($1::int[]), false, 1000, 8`,
      [rooms],
    );
    await client.query(
      `INSERT INTO room_enterprises (room_id, enterprise_id)
       SELECT unnest($1::int[]), $2`,
      [rooms, enterpriseId],
    );
    await client.query(
      `INSERT INTO room_queue_groups (room_id, queue_group_id)
       SELECT unnest($1::int[]), $2`,
      [rooms, queueGroupId],
    );
    await client.query(
      `UPDATE queue_settings
          SET schedule_start_at = now() - interval '1 minute',
              schedule_end_at = now() + interval '1 hour'`,
    );

    const repoRows = await client.query<{ id: number }>(
      `INSERT INTO repos (name)
       SELECT 'Event-day Team ' || id FROM users WHERE id = ANY($1::int[])
       ORDER BY id RETURNING id`,
      [participantIds],
    );
    const repoIds = repoRows.rows.map((row) => Number(row.id));
    await client.query(
      `INSERT INTO submissions (repo_id, user_id)
       SELECT unnest($1::int[]), unnest($2::int[])`,
      [repoIds, participantIds],
    );
    const entryRows = await client.query<{ id: number }>(
      `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
       SELECT $1, unnest($2::int[]), 'waiting', generate_subscripts($2::int[], 1)
       RETURNING id`,
      [challengeId, repoIds],
    );
    const entryIds = entryRows.rows.map((row) => Number(row.id));
    const meal = await client.query<{ id: number }>(
      `INSERT INTO activities (name, category, requires_scan)
       VALUES ('Event-day lunch', 'meal', true) RETURNING id`,
    );
    await client.query("COMMIT");

    const fixture: Fixture = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      database: databaseDescriptor(options.databaseUrl),
      participants,
      operators,
      judges,
      rooms,
      challengeId,
      entryIds,
      reviewEntryIds: entryIds.slice(0, Math.max(20, Math.min(40, entryIds.length))),
      mealActivityId: Number(meal.rows[0]?.id),
    };
    await mkdir(dirname(options.fixturePath), { recursive: true });
    await writeFile(options.fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    return fixture;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function metricKey(name: string, labels: Record<string, string>): string {
  const labelText = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(",");
  return `${name}{${labelText}}`;
}

function parseMetricLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const expression = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;
  for (const match of raw.matchAll(expression)) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) labels[key] = value.replace(/\\([\\"])/g, "$1");
  }
  return labels;
}

export function parsePrometheus(text: string): MetricSnapshot {
  const snapshot: MetricSnapshot = new Map();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([-+0-9.eE]+)$/.exec(line);
    if (!match) continue;
    const name = match[1];
    const labels = parseMetricLabels(match[2] ?? "");
    const value = Number(match[3]);
    if (!name || !Number.isFinite(value)) continue;
    snapshot.set(metricKey(name, labels), { name, labels, value });
  }
  return snapshot;
}

function metricValue(
  snapshot: MetricSnapshot,
  name: string,
  labels: Record<string, string> = {},
): number {
  return snapshot.get(metricKey(name, labels))?.value ?? 0;
}

function metricDelta(
  before: MetricSnapshot,
  after: MetricSnapshot,
  name: string,
  labels: Record<string, string> = {},
): number {
  return metricValue(after, name, labels) - metricValue(before, name, labels);
}

function parseHistogramDelta(
  before: MetricSnapshot,
  after: MetricSnapshot,
  name: string,
  labels: Record<string, string>,
): { count: number; sum: number; p95Estimate: number } {
  const count = metricDelta(before, after, `${name}_count`, labels);
  const sum = metricDelta(before, after, `${name}_sum`, labels);
  const buckets = [...after.values()]
    .filter(
      (metric) =>
        metric.name === `${name}_bucket` &&
        Object.entries(labels).every(([key, value]) => metric.labels[key] === value),
    )
    .map((metric) => ({
      le: Number(metric.labels.le),
      count: metric.value - metricValue(before, metric.name, metric.labels),
    }))
    .filter((bucket) => Number.isFinite(bucket.le))
    .sort((a, b) => a.le - b.le);
  const target = Math.max(1, count * 0.95);
  const bucket = buckets.find((item) => item.count >= target);
  return { count, sum, p95Estimate: bucket?.le ?? (count > 0 ? sum / count : 0) };
}

function percentileSummary(samples: Sample[]): {
  count: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  errorRate: number;
} {
  const latencies = samples.map((sample) => sample.latencyMs);
  const errors = samples.filter((sample) => sample.status >= 400 || sample.status === 0).length;
  return {
    count: samples.length,
    throughputRps: 0,
    p50Ms: quantile(latencies, 0.5),
    p95Ms: quantile(latencies, 0.95),
    p99Ms: quantile(latencies, 0.99),
    maxMs: latencies.length ? Math.max(...latencies) : 0,
    errorRate: samples.length ? errors / samples.length : 0,
  };
}

function headers(userId?: number, idempotencyKey?: string): Record<string, string> {
  const result: Record<string, string> = { accept: "application/json" };
  if (userId !== undefined && process.env.NODE_ENV === "test") {
    result["x-test-user-id"] = String(userId);
  }
  if (idempotencyKey) result["idempotency-key"] = idempotencyKey;
  return result;
}

async function requestSample(
  baseUrl: string,
  lane: Lane,
  operation: string,
  path: string,
  init: RequestInit = {},
  userId?: number,
): Promise<Sample> {
  const started = performance.now();
  try {
    const response = await fetch(new URL(path, `${baseUrl}/`), {
      ...init,
      headers: { ...headers(userId), ...(init.headers ?? {}) },
    });
    await response.arrayBuffer();
    return { lane, operation, status: response.status, latencyMs: performance.now() - started };
  } catch (error) {
    return {
      lane,
      operation,
      status: 0,
      latencyMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function openSse(
  baseUrl: string,
  lane: Lane,
  topic: string,
  path: string,
  userId?: number,
): Promise<{ sample: Sample; connection?: SseConnection }> {
  const controller = new AbortController();
  const started = performance.now();
  try {
    const response = await fetch(new URL(path, `${baseUrl}/`), {
      headers: headers(userId),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      await response.arrayBuffer();
      return {
        sample: {
          lane,
          operation: `sse:${topic}`,
          status: response.status,
          latencyMs: performance.now() - started,
        },
      };
    }
    const reader = response.body.getReader();
    await reader.read();
    return {
      sample: {
        lane,
        operation: `sse:${topic}`,
        status: response.status,
        latencyMs: performance.now() - started,
      },
      connection: {
        lane,
        topic,
        async close() {
          controller.abort();
          await reader.cancel().catch(() => {});
        },
      },
    };
  } catch (error) {
    controller.abort();
    return {
      sample: {
        lane,
        operation: `sse:${topic}`,
        status: 0,
        latencyMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function metricsSnapshot(baseUrl: string): Promise<MetricSnapshot> {
  try {
    const response = await fetch(new URL("/metrics", `${baseUrl}/`));
    return parsePrometheus(await response.text());
  } catch {
    return new Map();
  }
}

async function waitForApi(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = "unreachable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/healthz", `${baseUrl}/`));
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`API did not become healthy at ${baseUrl}: ${lastError}`);
}

async function runLoad(options: Options, fixture: Fixture): Promise<Record<string, unknown>> {
  if (options.mode !== "smoke") {
    assertInternalQualificationApi(options.baseUrl);
    if (process.env.NODE_ENV !== "test") {
      throw new Error(
        "Refusing qualification load: NODE_ENV=test is required so test auth is confined to the isolated stack.",
      );
    }
    if (process.env.QUALIFICATION_STACK !== "1") {
      throw new Error(
        "Refusing qualification load: QUALIFICATION_STACK=1 is required for the isolated stack.",
      );
    }
  }
  await waitForApi(options.baseUrl);
  const samples: Sample[] = [];
  const connections: SseConnection[] = [];
  const beforeMetrics = await metricsSnapshot(options.baseUrl);
  const wallStart = performance.now();

  const metricSamples: MetricSnapshot[] = [beforeMetrics];
  let samplerRunning = true;
  const sampler = (async () => {
    while (samplerRunning) {
      metricSamples.push(await metricsSnapshot(options.baseUrl));
      await sleep(250);
    }
  })();

  const rememberSse = async (result: { sample: Sample; connection?: SseConnection }) => {
    samples.push(result.sample);
    if (result.connection) connections.push(result.connection);
  };

  // One physical connection per participant's personal stream and per TV
  // invalidation stream; this is the event-day shape after browser dedupe.
  await Promise.all(
    fixture.participants.map((person) =>
      openSse(options.baseUrl, "P3", "user", "/api/queue/me/stream", person.id).then(rememberSse),
    ),
  );
  await Promise.all(
    Array.from({ length: options.tvs }, () =>
      openSse(options.baseUrl, "P2", "public-tv", "/api/tv/stream").then(rememberSse),
    ),
  );
  await Promise.all(
    fixture.reviewEntryIds
      .slice(0, Math.min(20, fixture.reviewEntryIds.length))
      .map((entryId, index) =>
        openSse(
          options.baseUrl,
          "P1",
          "queue-review",
          `/api/queue/entries/${entryId}/stream`,
          fixture.judges[index % fixture.judges.length],
        ).then(rememberSse),
      ),
  );
  await Promise.all(
    fixture.operators
      .slice(0, Math.min(4, fixture.operators.length))
      .map((operatorId) =>
        openSse(options.baseUrl, "P0", SSE_TOPICS.QUEUE, "/api/queue/stream", operatorId).then(
          rememberSse,
        ),
      ),
  );

  const traffic: Promise<Sample>[] = [];
  // P3 participant refetch burst. The admission queue is intentionally
  // allowed to shed this lane; any 429s are measured, not hidden.
  for (const person of fixture.participants) {
    traffic.push(
      requestSample(options.baseUrl, "P3", "participant:queue-me", "/api/queue/me", {}, person.id),
    );
  }
  // P0: accreditation, meal scans, and queue calls overlap in one burst.
  const unaccredited = fixture.participants.filter((person) => !person.badgeId);
  for (const [index, person] of unaccredited.entries()) {
    traffic.push(
      requestSample(
        options.baseUrl,
        "P0",
        "accreditation:check-in-user",
        "/api/accreditation/check-in-user",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `event-day-accredit-${person.id}`,
          },
          body: JSON.stringify({
            userId: person.id,
            badgeId: `event-day-late-badge-${person.id}`,
            method: "nfc",
          }),
        },
        fixture.operators[index % fixture.operators.length],
      ),
    );
  }
  const mealPeople = fixture.participants.filter((person) => person.badgeId);
  for (const [index, person] of mealPeople.entries()) {
    traffic.push(
      requestSample(
        options.baseUrl,
        "P0",
        "meal:scan",
        `/api/activities/${fixture.mealActivityId}/scan`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `event-day-meal-${person.id}`,
          },
          body: JSON.stringify({ badgeId: person.badgeId, allowRepeat: false }),
        },
        fixture.operators[index % fixture.operators.length],
      ),
    );
  }
  for (let i = 0; i < Math.min(fixture.entryIds.length, 120); i += 1) {
    traffic.push(
      requestSample(
        options.baseUrl,
        "P0",
        "queue:call-next",
        `/api/queue/rooms/${fixture.rooms[i % fixture.rooms.length]}/call-next`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `event-day-call-${i}`,
          },
          body: "{}",
        },
        fixture.operators[i % fixture.operators.length],
      ),
    );
  }

  // P1: concurrent autosaves from all judges on shared review rows.
  for (let i = 0; i < fixture.judges.length * 5; i += 1) {
    const entryId = fixture.reviewEntryIds[i % fixture.reviewEntryIds.length];
    traffic.push(
      requestSample(
        options.baseUrl,
        "P1",
        "review:autosave",
        `/api/queue/entries/${entryId}/review`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notes: `event-day collaborative save ${i}` }),
        },
        fixture.judges[i % fixture.judges.length],
      ),
    );
  }

  const oneShotResults = await Promise.all(traffic);
  samples.push(...oneShotResults);
  // Record one aggregate browser observation after the participant burst has
  // drained. The burst itself may shed this optional P3 diagnostic request;
  // the accepted observation makes the refetch counter measurable as well.
  samples.push(
    await requestSample(
      options.baseUrl,
      "P3",
      "participant:refetch-observation",
      "/api/telemetry/refetch-storm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          surface: "participant-queue",
          topic: "user",
          trigger: "sse",
          refetches: fixture.participants.length,
          windowSeconds: Math.max(1, Math.ceil(options.durationMs / 1_000)),
        }),
      },
    ),
  );

  // P2 screen refetches continue for the representative event window.
  const repeaterEnd = Date.now() + options.durationMs;
  const screenPollers = Array.from({ length: options.tvs }, async () => {
    while (Date.now() < repeaterEnd) {
      samples.push(
        await requestSample(options.baseUrl, "P2", "tv:mode", "/api/tv/mode"),
        await requestSample(options.baseUrl, "P2", "tv:rooms", "/api/tv/rooms"),
      );
      await sleep(1_000);
    }
  });
  await Promise.all(screenPollers);
  await sleep(500); // let the coalescing worker drain its 250 ms debounce.
  samplerRunning = false;
  await sampler;
  for (const connection of connections) await connection.close();
  await sleep(100);
  const afterMetrics = await metricsSnapshot(options.baseUrl);

  const elapsedSeconds = Math.max(0.001, (performance.now() - wallStart) / 1_000);
  const sseOpenedByLane = Object.fromEntries(
    (["P0", "P1", "P2", "P3"] as Lane[]).map((lane) => [
      lane,
      connections.filter((connection) => connection.lane === lane).length,
    ]),
  );
  const lanes = Object.fromEntries(
    (["P0", "P1", "P2", "P3"] as Lane[]).map((lane) => {
      const summary = percentileSummary(samples.filter((sample) => sample.lane === lane));
      summary.throughputRps = summary.count / elapsedSeconds;
      return [lane, summary];
    }),
  ) as Record<Lane, ReturnType<typeof percentileSummary>>;

  const admissionWait = Object.fromEntries(
    (["P0", "P1", "P2", "P3"] as Lane[]).map((lane) => [
      lane,
      parseHistogramDelta(
        beforeMetrics,
        afterMetrics,
        "hackos_http_request_admission_wait_seconds",
        { lane },
      ),
    ]),
  );
  const admissionQueueMax = Object.fromEntries(
    (["P0", "P1", "P2", "P3"] as Lane[]).map((lane) => [
      lane,
      Math.max(
        0,
        ...metricSamples.map((snapshot) =>
          metricValue(snapshot, "hackos_http_request_admission_queue_size", { lane }),
        ),
      ),
    ]),
  );
  const ssePeakByLane = Object.fromEntries(
    (["P0", "P1", "P2", "P3"] as Lane[]).map((lane) => [
      lane,
      Math.max(
        0,
        ...metricSamples.map((snapshot) =>
          [...snapshot.values()]
            .filter(
              (metric) =>
                metric.name === "hackos_sse_local_connections" && metric.labels.lane === lane,
            )
            .reduce((sum, metric) => sum + metric.value, 0),
        ),
      ),
    ]),
  );
  const invalidationOutcomes = Object.fromEntries(
    ["queued", "coalesced", "dropped", "degraded"].map((outcome) => [
      outcome,
      metricDelta(beforeMetrics, afterMetrics, "hackos_queue_participant_invalidations_total", {
        outcome,
      }),
    ]),
  );
  const browserRefetch = {
    storms: metricDelta(beforeMetrics, afterMetrics, "hackos_browser_refetch_storms_total", {
      surface: "participant-queue",
      topic: "user",
      trigger: "sse",
    }),
    refetches: metricDelta(beforeMetrics, afterMetrics, "hackos_browser_refetches_total", {
      surface: "participant-queue",
      topic: "user",
      trigger: "sse",
    }),
  };
  const budgetChecks = RELEASE_GATING_LANES.map((lane) => {
    const budget = DEFAULT_BUDGETS[lane];
    const summary = lanes[lane];
    return {
      lane,
      samples: summary.count,
      p95LatencyMs: summary.p95Ms,
      maxErrorRate: summary.errorRate,
      budget,
      passed:
        summary.count > 0 &&
        summary.p95Ms <= budget.p95LatencyMs &&
        summary.errorRate <= budget.maxErrorRate,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    command: redactedCommand(process.argv),
    releaseImage: process.env.QUALIFICATION_RELEASE_IMAGE ?? null,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: cpus().length,
      baseUrl: options.baseUrl,
      database: fixture.database,
      dbPoolMax: process.env.DB_POOL_MAX ?? null,
      workersInline: process.env.WORKERS_INLINE ?? null,
      nodeEnv: process.env.NODE_ENV ?? null,
    },
    fixture: {
      participants: fixture.participants.length,
      operators: fixture.operators.length,
      judges: fixture.judges.length,
      tvs: options.tvs,
      rooms: fixture.rooms.length,
      queueEntries: fixture.entryIds.length,
      reviewEntries: fixture.reviewEntryIds.length,
    },
    workload: {
      durationSeconds: options.durationMs / 1_000,
      elapsedSeconds,
      samples: samples.length,
      sseConnectionsOpened: connections.length,
    },
    lanes,
    admission: { waitSeconds: admissionWait, queueSizeMax: admissionQueueMax },
    realtime: {
      ssePeakByLane,
      ssePhysicalConnectionsOpenedByLane: sseOpenedByLane,
      ssePhysicalConnectionsPeak: connections.length,
      invalidationOutcomes,
      browserRefetch,
      finalSseByLane: Object.fromEntries(
        (["P0", "P1", "P2", "P3"] as Lane[]).map((lane) => [
          lane,
          [...afterMetrics.values()]
            .filter(
              (metric) =>
                metric.name === "hackos_sse_local_connections" && metric.labels.lane === lane,
            )
            .reduce((sum, metric) => sum + metric.value, 0),
        ]),
      ),
    },
    budgets: DEFAULT_BUDGETS,
    validation: {
      releaseBudgetPassed: budgetChecks.every((check) => check.passed),
      p0p1Passed: budgetChecks
        .filter((check) => check.lane === "P0" || check.lane === "P1")
        .every((check) => check.passed),
      budgetChecks,
      p3DegradationAllowed: true,
    },
    caveats: [
      "This is a single-process local representative run; it does not claim production capacity or validate #540 deployment budgets.",
      "P3 queue/me responses are intentionally best effort and 429/degraded outcomes are retained in the result rather than treated as a harness failure.",
      "SSE physical connections are opened directly with one user topic per participant; browser-side broker deduplication is represented by one stream per client and one aggregate refetch report.",
    ],
  };
}

function jsonResponse(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function startSmokeServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") return jsonResponse(res, 200, { ok: true });
    if (req.url === "/metrics") return res.end("# smoke\n");
    if (req.url?.endsWith("/stream")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": connected\\n\\n");
      return;
    }
    if (req.method === "POST" || req.method === "PATCH") {
      req.resume();
      req.on("end", () => jsonResponse(res, 200, { ok: true }));
      return;
    }
    return jsonResponse(res, 200, { ok: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Smoke server did not bind");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function smoke(): Promise<void> {
  const { server, baseUrl } = await startSmokeServer();
  const participants = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    badgeId: `badge-${index + 1}`,
  }));
  const fixture: Fixture = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    database: { host: "smoke", database: "smoke" },
    participants,
    operators: [20, 21],
    judges: [30, 31],
    rooms: [40, 41],
    challengeId: 50,
    entryIds: Array.from({ length: 12 }, (_, index) => index + 60),
    reviewEntryIds: [60, 61],
    mealActivityId: 70,
  };
  try {
    const result = await runLoad(
      {
        mode: "smoke",
        baseUrl,
        databaseUrl: DEFAULT_DATABASE_URL,
        fixturePath: DEFAULT_FIXTURE_PATH,
        outputPath: DEFAULT_OUTPUT_PATH,
        participants: participants.length,
        operators: 2,
        judges: 2,
        tvs: 2,
        durationMs: 1_000,
      },
      fixture,
    );
    const validation = result.validation as { p0p1Passed: boolean };
    const workload = result.workload as { samples: number; sseConnectionsOpened: number };
    if (!validation.p0p1Passed || workload.samples < 20 || workload.sseConnectionsOpened < 12) {
      throw new Error(`Smoke validation failed: ${JSON.stringify(result.validation)}`);
    }
    console.log(
      JSON.stringify({
        smoke: "passed",
        samples: workload.samples,
        sse: workload.sseConnectionsOpened,
      }),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "smoke") {
    await smoke();
    return;
  }
  if (options.mode === "prepare") {
    const fixture = await prepareFixture(options);
    console.log(
      JSON.stringify({
        prepared: true,
        fixture: options.fixturePath,
        counts: {
          participants: fixture.participants.length,
          operators: fixture.operators.length,
          judges: fixture.judges.length,
          rooms: fixture.rooms.length,
          queueEntries: fixture.entryIds.length,
        },
      }),
    );
    return;
  }
  const fixture = JSON.parse(await readFile(options.fixturePath, "utf8")) as Fixture;
  if (fixture.participants.length < 600 || fixture.operators.length + fixture.judges.length < 20) {
    throw new Error("Fixture does not meet #544 minimums (600 participants, 20 judges/operators)");
  }
  const result = await runLoad(options, fixture);
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      output: options.outputPath,
      passed: (result.validation as { releaseBudgetPassed: boolean }).releaseBudgetPassed,
      lanes: result.lanes,
      invalidations: (result.realtime as { invalidationOutcomes: unknown }).invalidationOutcomes,
    }),
  );
  if (!(result.validation as { releaseBudgetPassed: boolean }).releaseBudgetPassed)
    process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
