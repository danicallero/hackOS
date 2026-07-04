import type { FastifyInstance } from "fastify";
import { registerEventRoutes } from "./routes.js";

/**
 * WS-G — event-wide config (H45/H47): the public hacking-window countdown for
 * the website and TV panels. Singleton, upserted; publicly readable.
 */
export async function registerEventModule(app: FastifyInstance): Promise<void> {
  registerEventRoutes(app);
}
