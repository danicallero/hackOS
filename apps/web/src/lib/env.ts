/**
 * Public runtime config. The web app talks to the Fastify API (Better Auth
 * included) at this origin. Never hardcode `localhost` in components — read it
 * here, mirroring the API's zod-validated `src/config.ts`.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
