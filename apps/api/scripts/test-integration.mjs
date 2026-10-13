import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const baseDatabaseUrl = new URL(
  process.env.TEST_DATABASE_URL ?? "postgres://hackos:hackos@localhost:5433/hackos_test",
);

const shardDirectories = [
  ["identity", "applications"],
  ["queue", "logistics", "live-activities"],
  ["projects", "work-groups", "diary", "directory", "challenges", "sponsors", "event"],
  ["notifications", "exports", "statistics"],
];

// #992: assign by directory ownership, never by Vitest substring filters.
async function discoverTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return discoverTests(path);
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
    }),
  );
  return files.flat().sort();
}

const files = await discoverTests("test");
const shards = shardDirectories.map((directories, index) =>
  files.filter((file) => {
    const parts = file.split("/");
    return parts.length === 2 ? index === 3 : directories.includes(parts[1]);
  }),
);
const assignments = shards.flat();
const invalid = files.filter(
  (file) => assignments.filter((assigned) => assigned === file).length !== 1,
);
if (invalid.length > 0) {
  throw new Error(
    `API tests must belong to exactly one shard (unassigned or duplicated): ${invalid.join(", ")}`,
  );
}

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
    const child = spawn("pnpm", ["exec", "vitest", "run"], {
      env: {
        ...process.env,
        API_TEST_SHARD_FILES: JSON.stringify(paths),
        TEST_DATABASE_URL: databaseUrlFor(shardNumber),
        TEST_DATABASE_EPHEMERAL: "true",
        ...(process.env.CI === "true" && process.env.S3_BUCKET
          ? { S3_BUCKET: `${process.env.S3_BUCKET}-shard-${shardNumber}` }
          : {}),
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
