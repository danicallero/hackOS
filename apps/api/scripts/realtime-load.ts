/** Isolated 600-instance legacy/multiplexed SSE comparison (#892); never targets an attendee API. */
import { fork } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { RealtimeClient } from "@hackos/shared/realtime-client";
import pg from "pg";
import { migrate } from "./migrate.js";

const file = fileURLToPath(import.meta.url);
const clients = Number(process.env.REALTIME_LOAD_CLIENTS ?? 600);
const durationMs = Number(process.env.REALTIME_LOAD_DURATION_MS ?? 30_000);
const output = resolve(process.env.REALTIME_LOAD_OUTPUT ?? "../../docs/realtime-load-results.json");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function server() {
  const db = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== "test" ||
    !/^\/hackos_realtime_qualification_[a-f0-9]+$/.test(db.pathname) ||
    !["localhost", "127.0.0.1"].includes(db.hostname)
  )
    throw new Error("Qualification database only");
  const { buildApp } = await import("../src/app.js");
  const { broadcast } = await import("../src/lib/sse.js");
  const { register } = await import("../src/lib/metrics.js");
  const { pool } = await import("../src/db/pool.js");
  const { closeValkey } = await import("../src/lib/valkey.js");
  const { stopQueues } = await import("../src/lib/queues.js");
  const app = await buildApp();
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  process.send?.({ address });
  process.on("message", async (message: { id: number; action: string }) => {
    if (message.action === "publish") {
      await broadcast(SSE_TOPICS.IDENTITY, EVENTS.DOMAIN_CHANGED, {});
      await broadcast(SSE_TOPICS.PROJECTS, EVENTS.DOMAIN_CHANGED, {});
    }
    if (message.action === "stop") {
      await app.close();
      await stopQueues();
      await closeValkey();
      await pool.end();
      process.exit(0);
    }
    process.send?.({
      id: message.id,
      metrics: await register.metrics(),
      memory: process.memoryUsage(),
    });
  });
}

function total(metrics: string, name: string, contains = ""): number {
  return metrics
    .split("\n")
    .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `))
    .filter((line) => !contains || line.includes(contains))
    .reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(" ") + 1)), 0);
}

async function compare(databaseUrl: string, mode: "legacy" | "multiplexed") {
  const child = fork(file, ["--server"], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      WORKERS_INLINE: "false",
      VALKEY_URL: "redis://localhost:6379/13",
      DB_POOL_MAX: "24",
      SSE_MAX_CONNECTIONS_PER_TOPIC: "2000",
    },
  });
  const pending = new Map<
    number,
    (result: { metrics: string; memory: NodeJS.MemoryUsage }) => void
  >();
  let requestId = 0;
  child.on("message", (message: { id?: number; metrics: string; memory: NodeJS.MemoryUsage }) => {
    if (message.id !== undefined) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const address = await new Promise<string>((done, reject) => {
    child.on("message", (message: { address?: string }) => {
      if (message.address) done(message.address);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code) reject(new Error(`Server exited ${code}`));
    });
  });
  const rpc = (action: string) =>
    new Promise<{ metrics: string; memory: NodeJS.MemoryUsage }>((done) => {
      const id = requestId++;
      pending.set(id, done);
      child.send({ id, action });
    });
  const baseline = await rpc("metrics");
  const managers: RealtimeClient[][] = [];
  const releases: (() => void)[] = [];
  const refetchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const reads: Promise<void>[] = [];
  let refetches = 0;
  let refetchErrors = 0;
  const refetchStatuses: Record<string, number> = {};
  let opened = 0;
  let closed = 0;
  let connected = 0;
  let rssPeak = baseline.memory.rss;
  let heapPeak = baseline.memory.heapUsed;
  const paths = {
    personal: "/api/queue/me/stream",
    "domain:identity": "/api/events/stream?topic=identity",
    "domain:projects": "/api/events/stream?topic=projects",
  };
  const refetch = (user: number, scope: string) => {
    const path = scope === "domain:projects" ? "/api/me/projects" : "/api/me";
    const key = `${user}:${path}`;
    if (refetchTimers.has(key)) return;
    refetchTimers.set(
      key,
      setTimeout(() => {
        refetchTimers.delete(key);
        refetches++;
        reads.push(
          fetch(`${address}${path}`, { headers: { "x-test-user-id": String(user) } })
            .then(async (response) => {
              refetchStatuses[String(response.status)] =
                (refetchStatuses[String(response.status)] ?? 0) + 1;
              if (!response.ok) refetchErrors++;
              await response.arrayBuffer();
            })
            .catch(() => {
              refetchErrors++;
              refetchStatuses.network_error = (refetchStatuses.network_error ?? 0) + 1;
            }),
        );
      }, 100),
    );
  };
  try {
    for (let user = 1; user <= clients; user++) {
      const instance: RealtimeClient[] = [];
      const make = (publicPath?: string) =>
        new RealtimeClient({
          publicPath,
          headers: () => ({ "x-test-user-id": String(user) }),
          onPhysicalConnection: (_url, state) => {
            if (state === "opened") opened++;
            else closed++;
          },
        });
      const shared = mode === "multiplexed" ? make() : null;
      if (shared) {
        shared.setIdentity(user, address);
        instance.push(shared);
      }
      for (const [scope, path] of Object.entries(paths)) {
        const manager = shared ?? make(path);
        if (!shared) {
          manager.setIdentity(user, address);
          instance.push(manager);
        }
        releases.push(
          manager.subscribe({
            scope,
            onEvent: () => refetch(user, scope),
            onResync: () => refetch(user, scope),
            onConnectionChange: (value) => {
              if (value) connected++;
            },
          }),
        );
      }
      managers.push(instance);
      // Bound startup pressure instead of testing admission overflow.
      if (user % 20 === 0) await sleep(100);
    }
    const admissionDeadline = Date.now() + 30_000;
    while (connected < clients * 3 && Date.now() < admissionDeadline) await sleep(100);
    const admitted = await rpc("metrics");
    const physicalPeak = total(admitted.metrics, "hackos_sse_local_connections");
    const logicalPeak = total(admitted.metrics, "hackos_sse_local_subscriptions");
    if (physicalPeak !== clients * (mode === "legacy" ? 3 : 1))
      throw new Error(`Admission mismatch: ${physicalPeak}`);
    const startedAt = Date.now();
    let published = false;
    let recovered = false;
    const initialOpened = opened;
    while (Date.now() - startedAt < durationMs) {
      const elapsed = Date.now() - startedAt;
      if (elapsed > 1000 && !published) {
        await rpc("publish");
        published = true;
      }
      if (elapsed > 5000 && !recovered) {
        for (const instance of managers.slice(0, Math.floor(clients / 10))) {
          for (const manager of instance) manager.setActive(false);
          for (const manager of instance) manager.setActive(true);
        }
        recovered = true;
      }
      const sample = await rpc("metrics");
      rssPeak = Math.max(rssPeak, sample.memory.rss);
      heapPeak = Math.max(heapPeak, sample.memory.heapUsed);
      await sleep(500);
    }
    await Promise.all(reads);
    const end = await rpc("metrics");
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    return {
      mode,
      clients,
      scopesPerClient: 3,
      durationSeconds: elapsedSeconds,
      physicalConnectionsPeak: physicalPeak,
      logicalSubscriptionsPeak: logicalPeak,
      apiRssBaselineBytes: baseline.memory.rss,
      apiRssPeakBytes: rssPeak,
      apiHeapPeakBytes: heapPeak,
      heartbeatWrites:
        total(end.metrics, "hackos_sse_writes_total", 'kind="heartbeat"') -
        total(baseline.metrics, "hackos_sse_writes_total", 'kind="heartbeat"'),
      eventWrites:
        total(end.metrics, "hackos_sse_writes_total", 'kind="event"') -
        total(baseline.metrics, "hackos_sse_writes_total", 'kind="event"'),
      transportReopens: opened - initialOpened,
      reconnectsPerSecond: (opened - initialOpened) / elapsedSeconds,
      apiRefetches: refetches,
      apiRefetchesPerSecond: refetches / elapsedSeconds,
      apiRefetchErrors: refetchErrors,
      apiRefetchStatuses: refetchStatuses,
      reauthorizations: total(end.metrics, "hackos_sse_reauthorizations_total"),
      closedTransportsDuringRun: closed,
    };
  } finally {
    for (const release of releases) release();
    for (const timer of refetchTimers.values()) clearTimeout(timer);
    await Promise.allSettled(reads);
    child.send({ id: requestId++, action: "stop" });
    await new Promise<void>((done) => child.once("exit", () => done()));
  }
}

async function main() {
  if (
    !Number.isInteger(clients) ||
    clients < 1 ||
    clients > 600 ||
    durationMs < 10_000 ||
    durationMs > 120_000
  )
    throw new Error("Use 1–600 clients and 10–120 seconds");
  const adminUrl = new URL(
    process.env.REALTIME_LOAD_DATABASE_URL ?? "postgres://hackos:hackos@localhost:5433/postgres",
  );
  if (!["localhost", "127.0.0.1"].includes(adminUrl.hostname))
    throw new Error("Local qualification database only");
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const name = `hackos_realtime_qualification_${crypto.randomUUID().replaceAll("-", "")}`;
  const database = new URL(adminUrl);
  database.pathname = `/${name}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  try {
    await migrate(database.toString());
    const db = new pg.Client({ connectionString: database.toString() });
    await db.connect();
    try {
      await db.query(
        `INSERT INTO users (email, name, email_verified)
      SELECT 'realtime-' || n || '@qualification.local', 'Realtime ' || n, true FROM generate_series(1, $1::int) n`,
        [clients],
      );
    } finally {
      await db.end();
    }
    const legacy = await compare(database.toString(), "legacy");
    console.log(JSON.stringify(legacy));
    const multiplexed = await compare(database.toString(), "multiplexed");
    console.log(JSON.stringify(multiplexed));
    await writeFile(
      output,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          environment: {
            node: process.version,
            database: "isolated ephemeral local Postgres",
            apiPool: 24,
            perTopicLimit: 2000,
          },
          scenario:
            "Three logical scopes per instance; one identity/project event each; 10% of instances background/foreground at 5 seconds; coalesced authoritative HTTP reads; separate API processes per mode.",
          limitations:
            "Local qualification, not production capacity certification. No browser/native rendering, judging WebSocket, proxy, real cookies, scanner writes or unrelated workloads. Per-topic limit raised from 500 to admit 600 common-domain subscribers. Memory is process peak without forced GC. Reconnects are controlled foreground recoveries.",
          legacy,
          multiplexed,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}
if (process.argv.includes("--server")) await server();
else await main();
