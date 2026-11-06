import pg from "pg";

/**
 * Shared plumbing for the production-safe superadmin scripts (plain `node`, no
 * tsx): flag parsing and the connect / BEGIN / COMMIT / ROLLBACK / end lifecycle.
 */

export function readFlag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

export function hasFlag(name) {
  return process.argv.includes(name);
}

/** Required `--email`, trimmed and lower-cased. */
export function requireEmailFlag() {
  const email = readFlag("--email")?.trim().toLowerCase();
  if (!email) throw new Error("Missing required flag: --email");
  return email;
}

/** Run `fn(client)` on a fresh connection that is always closed. */
export async function withClient(fn) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Like {@link withClient}, inside one transaction that rolls back when `fn` throws. */
export function withClientTransaction(fn) {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
}
