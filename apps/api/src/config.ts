import "dotenv/config";
import { z } from "zod";

const hexColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().default("postgres://hackos:hackos@localhost:5433/hackos"),
  VALKEY_URL: z.string().default("redis://localhost:6379"),

  BETTER_AUTH_URL: z.string().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().default("dev-only-secret-change-me"),

  /**
   * Public origin of the web frontend. Auth emails (verification, reset) link
   * back to the API but redirect the browser here afterwards, so links land on
   * a real page instead of a raw API response. Also trusted for auth
   * (trustedOrigins). Defaults to the local Next dev server.
   */
  WEB_URL: z.string().default("http://localhost:3001"),

  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_ACCESS_KEY: z.string().default("hackos"),
  S3_SECRET_KEY: z.string().default("hackos-secret"),
  S3_BUCKET: z.string().default("hackos"),
  S3_REGION: z.string().default("us-east-1"),
  /**
   * Base URL objects are publicly served from. Defaults to path-style MinIO
   * (S3_ENDPOINT/S3_BUCKET); set to a CDN / public bucket host in production.
   */
  S3_PUBLIC_URL: z.string().optional(),

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
   * Email layout theming (H52): build/deploy-time customization for the
   * branded wrapper without changing templates in code.
   */
  MAIL_LAYOUT_BRAND_NAME: z.string().min(1).default("hackOS"),
  MAIL_LAYOUT_HEADER_TEXT: z.string().min(1).default("hackOS"),
  MAIL_LAYOUT_HEADER_SUBTEXT: z.string().default("Hackathon management platform"),
  MAIL_LAYOUT_ACCENT_COLOR: z.string().regex(hexColor).default("#4f46e5"),
  MAIL_LAYOUT_BG_COLOR: z.string().regex(hexColor).default("#eef1f5"),
  MAIL_LAYOUT_CARD_COLOR: z.string().regex(hexColor).default("#ffffff"),
  MAIL_LAYOUT_CARD_BORDER_COLOR: z.string().regex(hexColor).default("#dde3ee"),
  MAIL_LAYOUT_TEXT_COLOR: z.string().regex(hexColor).default("#1f2430"),
  MAIL_LAYOUT_MUTED_TEXT_COLOR: z.string().regex(hexColor).default("#667085"),
  MAIL_LAYOUT_FOOTER_BG_COLOR: z.string().regex(hexColor).default("#f7f9fc"),
  MAIL_LAYOUT_CARD_RADIUS: z.coerce.number().int().min(0).max(32).default(14),
  MAIL_LAYOUT_MAX_WIDTH: z.coerce.number().int().min(360).max(720).default(560),
  MAIL_FOOTER_TEXT: z.string().min(1).default("hackOS — this is an automated message."),

  /**
   * Run BullMQ workers inside the API process. Default on for dev/test;
   * in production deploys run a dedicated worker container (src/worker.ts).
   */
  WORKERS_INLINE: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  /**
   * Trust X-Forwarded-* headers. Enable when the API sits behind a reverse
   * proxy (Traefik/Dokploy) so the real client IP reaches the audit trail
   * (H53) instead of the proxy's address. Never enable when directly exposed.
   */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  /**
   * Comma-separated list of allowed browser origins (the web/TV app URLs).
   * In production CORS is restricted to exactly this list; in dev it reflects
   * any origin. Credentials are always allowed, so a bare "*" is refused here.
   */
  CORS_ORIGINS: z.string().default(""),

  LOG_LEVEL: z.string().default("info"),

  /**
   * Apple Wallet / PassKit (H28). Neither platform is boot-mandatory — a
   * deploy without these just serves a clear 503 on the wallet endpoints
   * instead of an invalid/empty-signature pass. `*_PEM` values are
   * base64-encoded PEM content (not file paths): single-line env values are
   * how every other secret in this app is configured (S3, mail, auth), and
   * base64 sidesteps the newline problem with raw PEM in an env var.
   */
  APPLE_PASS_TYPE_IDENTIFIER: z.string().optional(),
  APPLE_TEAM_IDENTIFIER: z.string().optional(),
  APPLE_PASS_ORGANIZATION: z.string().default("hackOS"),
  APPLE_PASS_CERTIFICATE_PEM: z.string().optional(),
  APPLE_PASS_KEY_PEM: z.string().optional(),
  APPLE_PASS_KEY_PASSPHRASE: z.string().optional(),
  APPLE_WWDR_CERTIFICATE_PEM: z.string().optional(),
  /** Which APNs gateway to push pass updates to (H28). */
  APPLE_APNS_ENVIRONMENT: z.enum(["production", "sandbox"]).default("production"),

  /**
   * Google Wallet (H28). Same "optional but never silently broken" posture
   * as Apple above — see APPLE_PASS_CERTIFICATE_PEM comment.
   */
  GOOGLE_WALLET_ISSUER_ID: z.string().optional(),
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_WALLET_PRIVATE_KEY_PEM: z.string().optional(),
});

const parsed = envSchema
  .superRefine((v, ctx) => {
    // A half-set platform is almost always a deploy mistake (typo'd var
    // name, one secret missing from the store) — catch it at boot, in every
    // env, without requiring the platform to be configured at all.
    const apple = [
      v.APPLE_PASS_CERTIFICATE_PEM,
      v.APPLE_PASS_KEY_PEM,
      v.APPLE_WWDR_CERTIFICATE_PEM,
    ];
    if (apple.some(Boolean) && !apple.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        message:
          "APPLE_PASS_CERTIFICATE_PEM, APPLE_PASS_KEY_PEM and APPLE_WWDR_CERTIFICATE_PEM must be set together (H28)",
      });
    }
    const google = [
      v.GOOGLE_WALLET_ISSUER_ID,
      v.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL,
      v.GOOGLE_WALLET_PRIVATE_KEY_PEM,
    ];
    if (google.some(Boolean) && !google.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        message:
          "GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL and GOOGLE_WALLET_PRIVATE_KEY_PEM must be set together (H28)",
      });
    }
  })
  .parse(process.env);

export const config = {
  ...parsed,
  isTest: parsed.NODE_ENV === "test",
  isProd: parsed.NODE_ENV === "production",
  workersInline: parsed.WORKERS_INLINE ?? parsed.NODE_ENV !== "production",
  trustProxy: parsed.TRUST_PROXY ?? parsed.NODE_ENV === "production",
  appleWalletConfigured: Boolean(
    parsed.APPLE_PASS_CERTIFICATE_PEM &&
      parsed.APPLE_PASS_KEY_PEM &&
      parsed.APPLE_WWDR_CERTIFICATE_PEM,
  ),
  googleWalletConfigured: Boolean(
    parsed.GOOGLE_WALLET_ISSUER_ID &&
      parsed.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL &&
      parsed.GOOGLE_WALLET_PRIVATE_KEY_PEM,
  ),
};

export type Config = typeof config;
