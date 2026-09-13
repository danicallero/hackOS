import { spawn } from "node:child_process";

const baseDatabaseUrl = new URL(
  process.env.TEST_DATABASE_URL ?? "postgres://hackos:hackos@localhost:5433/hackos_test",
);

const shards = [
  ["identity", "applications"],
  ["queue", "logistics"],
  ["projects", "challenges", "sponsors", "event"],
  ["notifications", "exports", "test/*.test.ts", "test/statistics"],
];

function databaseUrlFor(shardNumber) {
  const url = new URL(baseDatabaseUrl);
  const baseName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(baseName)) {
    throw new Error(`Unsafe TEST_DATABASE_URL database name: ${baseName}`);
  }
  url.pathname = `/${baseName}_shard_${shardNumber}`;
  return url.toString();
}

function runShard(paths, shardNumber) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "vitest", "run", ...paths], {
      env: {
        ...process.env,
        TEST_DATABASE_URL: databaseUrlFor(shardNumber),
        TEST_DATABASE_EPHEMERAL: "true",
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`API test shard ${shardNumber} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

await Promise.all(shards.map(runShard));
