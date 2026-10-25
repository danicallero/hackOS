import "dotenv/config";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const baseDatabaseUrl = new URL(
  process.env.TEST_DATABASE_URL ?? "postgres://hackos:hackos@localhost:5433/hackos_test",
);

// H53: balance measured suite time without splitting a domain. Each shard
// receives independent Postgres, Valkey and storage namespaces below.
const shardDirectories = [
  ["identity", "certificates", "notifications", "directory", "event"],
  ["queue", "live-activities", "exports", "diary"],
  ["logistics", "projects", "github", "reports", "sponsors"],
  ["applications", "challenges", "statistics"],
];

const bucketFor = (shardNumber) => `${process.env.S3_BUCKET ?? "hackos"}-shard-${shardNumber}`;

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

// H54: local shards need the same storage isolation as CI. User/project IDs
// restart in each database, so a removal must never delete a sibling's files.
const storage = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "hackos",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "hackos-secret",
  },
  maxAttempts: 1,
});
try {
  await Promise.all(
    shards.map(async (_, index) => {
      const Bucket = bucketFor(index);
      try {
        await storage.send(new HeadBucketCommand({ Bucket }), {
          abortSignal: AbortSignal.timeout(5_000),
        });
      } catch (error) {
        if (error.$metadata?.httpStatusCode !== 404) throw error;
        await storage.send(new CreateBucketCommand({ Bucket }), {
          abortSignal: AbortSignal.timeout(5_000),
        });
      }
    }),
  );
} finally {
  storage.destroy();
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

function valkeyUrlFor(shardNumber) {
  const url = new URL(
    process.env.TEST_VALKEY_URL ?? process.env.VALKEY_URL ?? "redis://localhost:6379/0",
  );
  const firstDatabase = Number(url.pathname.slice(1) || "0");
  if (!Number.isInteger(firstDatabase) || firstDatabase < 0 || firstDatabase + shards.length > 16) {
    throw new Error("The API test Valkey base database must leave room for all four shards (0–15)");
  }
  url.pathname = `/${firstDatabase + shardNumber}`;
  return url.toString();
}

function runShard(paths, shardNumber) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "vitest", "run", "--reporter=verbose"], {
      env: {
        ...process.env,
        API_TEST_SHARD_FILES: JSON.stringify(paths),
        TEST_DATABASE_URL: databaseUrlFor(shardNumber),
        TEST_DATABASE_EPHEMERAL: "true",
        TEST_VALKEY_URL: valkeyUrlFor(shardNumber),
        VALKEY_URL: valkeyUrlFor(shardNumber),
        S3_BUCKET: bucketFor(shardNumber),
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

// H53: collect every shard's result before exiting, including after a failure.
const results = await Promise.allSettled(shards.map(runShard));
const failures = results.filter((result) => result.status === "rejected");
if (failures.length > 0) {
  throw new AggregateError(
    failures.map((result) => result.reason),
    "API integration tests failed",
  );
}
