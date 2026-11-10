import type { FastifyInstance } from "fastify";
import { registerRsvpRoutes } from "./routes.js";

/**
 * Per-activity RSVPs: organizer settings (schedule:manage), attendee answers,
 * staff corrections and logistics headcounts. Meal-plan routes under identity
 * and logistics are facades over this module.
 */
export function registerRsvpsModule(app: FastifyInstance): void {
  registerRsvpRoutes(app);
}
