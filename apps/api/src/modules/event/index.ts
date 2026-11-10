import type { FastifyInstance } from "fastify";
import { registerOnboardingConfigRoutes } from "./onboarding-config.js";
import { scheduleEventReminders } from "./reminders.js";
import { registerEventRoutes } from "./routes.js";

/**
 * WS-G — event-wide config (H45/H47): the public hacking-window countdown for
 * the website and TV panels. Singleton, upserted; publicly readable.
 */
export async function registerEventModule(app: FastifyInstance): Promise<void> {
  registerEventRoutes(app);
  registerOnboardingConfigRoutes(app);
  await scheduleEventReminders();
}
