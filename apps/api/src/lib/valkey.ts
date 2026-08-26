import { Redis, type RedisOptions } from "ioredis";
import { config } from "../config.js";

/**
 * API-facing Valkey connections. Commands must fail promptly while Valkey is
 * unavailable: callers either degrade to PostgreSQL/default state or report a
 * best-effort notification failure. BullMQ has its own reliability policy in
 * queues.ts and must never reuse these options (issue #535).
 */
export const API_VALKEY_CONNECTION_OPTS = {
  connectTimeout: 1_000,
  commandTimeout: 1_000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
} as const satisfies RedisOptions;

export const valkey = new Redis(config.VALKEY_URL, API_VALKEY_CONNECTION_OPTS);
export const valkeySub = new Redis(config.VALKEY_URL, API_VALKEY_CONNECTION_OPTS);

/** With the offline queue disabled, commands issued during ioredis's initial
 * TCP handshake would otherwise fail even when Valkey is healthy. Give that
 * one startup handshake the same bounded window as a command; later outages
 * still reject immediately and reconnect in the background. */
async function waitForInitialConnection(client: Redis): Promise<void> {
  if (client.status === "ready") return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      client.off("ready", done);
      resolve();
    };
    const timer = setTimeout(done, API_VALKEY_CONNECTION_OPTS.connectTimeout);
    client.once("ready", done);
  });
}

await Promise.all([waitForInitialConnection(valkey), waitForInitialConnection(valkeySub)]);

export async function closeValkey(): Promise<void> {
  await Promise.allSettled([valkey.quit(), valkeySub.quit()]);
}
