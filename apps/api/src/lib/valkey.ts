import { Redis } from "ioredis";
import { config } from "../config.js";

/**
 * Shared Valkey connections. `valkey` for commands (cache, BullMQ reuses its
 * own), `valkeySub` dedicated to pub/sub subscriptions (ioredis requires a
 * separate connection once SUBSCRIBE is issued).
 */
export const valkey = new Redis(config.VALKEY_URL, { maxRetriesPerRequest: null });
export const valkeySub = new Redis(config.VALKEY_URL, { maxRetriesPerRequest: null });

export async function closeValkey(): Promise<void> {
  await Promise.allSettled([valkey.quit(), valkeySub.quit()]);
}
