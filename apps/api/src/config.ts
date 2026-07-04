import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().default("postgres://hackos:hackos@localhost:5433/hackos"),
  VALKEY_URL: z.string().default("redis://localhost:6379"),

  BETTER_AUTH_URL: z.string().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().default("dev-only-secret-change-me"),

  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_ACCESS_KEY: z.string().default("hackos"),
  S3_SECRET_KEY: z.string().default("hackos-secret"),
  S3_BUCKET: z.string().default("hackos"),

  /**
   * Mail provider (H52). DELTA(H52): the story says the provider is chosen
   * "por base de datos"; per explicit user decision the provider is fixed at
   * deploy time via env instead — switching Resend/SMTP/Postal is an ops
   * change (redeploy/restart), not a runtime DB toggle. Defaults target the
   * local Mailpit container (pnpm infra:up).
   */
  MAIL_PROVIDER: z.enum(["smtp", "resend", "postal"]).default("smtp"),
  MAIL_FROM_ADDRESS: z.string().default("noreply@hackos.local"),
  MAIL_FROM_NAME: z.string().default("hackOS"),
  RESEND_API_KEY: z.string().optional(),
  POSTAL_URL: z.string().optional(),
  POSTAL_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  /**
   * Run BullMQ workers inside the API process. Default on for dev/test;
   * in production deploys run a dedicated worker container (src/worker.ts).
   */
  WORKERS_INLINE: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  LOG_LEVEL: z.string().default("info"),
});

const parsed = envSchema.parse(process.env);

export const config = {
  ...parsed,
  isTest: parsed.NODE_ENV === "test",
  isProd: parsed.NODE_ENV === "production",
  workersInline: parsed.WORKERS_INLINE ?? parsed.NODE_ENV !== "production",
};

export type Config = typeof config;
