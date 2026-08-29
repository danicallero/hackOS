import "dotenv/config";
import { z } from "zod";

const hexColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().default("postgres://hackos:hackos@localhost:5433/hackos"),
  /**
   * Postgres pool tuning (H540). `DB_POOL_MAX` is per-process — api and
   * worker each hold their own pool, and every replica of each multiplies
   * it — so (api replicas × DB_POOL_MAX) + (worker replicas × DB_POOL_MAX)
   * must stay under Postgres's own `max_connections`, with headroom for
   * `migrate`'s one-shot connections and admin/superuser use. Raise it for
   * big-event load — see docs/big-event-readiness.md, docs/env-vars.md and
   * docs/architecture.md.
   */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).optional(),
  /** How long an idle pooled connection is kept before being closed. */
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  /** How long to wait for a free connection before `pool.connect()` rejects. */
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
  /** Postgres `statement_timeout`: kills a runaway query instead of holding a connection forever. */
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  /** Postgres `idle_in_transaction_session_timeout`: reclaims a connection stuck mid-transaction. */
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  VALKEY_URL: z.string().default("redis://localhost:6379"),

  BETTER_AUTH_URL: z.string().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().default("dev-only-secret-change-me"),

  /**
   * Synthetic reviewer/QA fixture credentials (H54). These are deliberately
   * unset by default: the same deployed instance must explicitly opt into the
   * fixture workspace and receive both secrets out of band. The deletion PIN
   * is accepted only for users marked is_test_account=true; real verified
   * accounts always use the one-time PIN delivered to their primary email.
   */
  REVIEW_FIXTURE_PASSWORD: z.preprocess(
    // Deploy compose files pass unset optional vars as ""; treat that as
    // absent so the optional fixture workspace does not prevent booting.
    (v) => (v === "" ? undefined : v),
    z.string().min(8).optional(),
  ),
  REVIEW_FIXTURE_DELETION_PIN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  ),

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
  MAIL_LAYOUT_HEADER_SUBTEXT: z.string().default(""),
  /**
   * Browser-reachable PNG/JPEG logo shown in the header instead of
   * MAIL_LAYOUT_HEADER_TEXT (SVG is unsafe in most email clients). Unset
   * defaults to the hackOS brand mark served from WEB_URL; set to "" to
   * fall back to the plain-text header instead.
   */
  MAIL_LAYOUT_LOGO_URL: z.string().optional(),
  // Defaults mirror apps/web's shadcn "zinc" tokens (apps/web/src/app/globals.css) so
  // transactional email reads as the same product, not a differently-branded surface.
  MAIL_LAYOUT_ACCENT_COLOR: z.string().regex(hexColor).default("#18181b"),
  MAIL_LAYOUT_BG_COLOR: z.string().regex(hexColor).default("#f4f4f5"),
  MAIL_LAYOUT_CARD_COLOR: z.string().regex(hexColor).default("#ffffff"),
  MAIL_LAYOUT_CARD_BORDER_COLOR: z.string().regex(hexColor).default("#e4e4e7"),
  MAIL_LAYOUT_TEXT_COLOR: z.string().regex(hexColor).default("#18181b"),
  MAIL_LAYOUT_MUTED_TEXT_COLOR: z.string().regex(hexColor).default("#71717a"),
  MAIL_LAYOUT_FOOTER_BG_COLOR: z.string().regex(hexColor).default("#fafafa"),
  MAIL_LAYOUT_CARD_RADIUS: z.coerce.number().int().min(0).max(32).default(8),
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

  /**
   * Custom URL scheme of the Expo mobile app (H4, H55). Native requests carry
   * no real browser Origin, so Better Auth's `expo()` plugin stamps this
   * scheme on the Origin header instead — it must be in trustedOrigins for
   * mobile sign-in to pass Better Auth's origin check.
   */
  MOBILE_APP_SCHEME: z.string().default("hackos"),

  LOG_LEVEL: z.string().default("info"),

  /**
   * SSE connection budgets and slow-client backpressure (H540). Defaults are
   * a generous safety net (bound runaway reconnect loops / a stuck client),
   * not a tight production cap — see docs/env-vars.md.
   */
  SSE_MAX_CONNECTIONS_GLOBAL: z.coerce.number().int().positive().default(2_000),
  SSE_MAX_CONNECTIONS_PER_TOPIC: z.coerce.number().int().positive().default(500),
  SSE_MAX_CONNECTIONS_PER_CLIENT: z.coerce.number().int().positive().default(20),
  /** How long a slow client has to drain a backpressured write before being disconnected. */
  SSE_WRITE_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  /**
   * Rows claimed per outbox-dispatcher tick (H52, plan/07 §5.4), each
   * dispatched and committed in its own transaction (dispatcher.ts) so
   * raising this doesn't grow the duplicate-send blast radius of a mid-batch
   * crash. The drain runs every 5s regardless of batch size; 100 covers a
   * mass-send (an announcement fanned out to every attendee on 2-3 channels
   * at once) without needing to bump it per event. See
   * docs/big-event-readiness.md.
   */
  NOTIFICATION_OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),

  /**
   * Operational rate limits for scanner mutations (#538, docs/rate-limiting.md),
   * per authenticated staff user, backed by Valkey (`lib/rate-limit.ts`) so
   * they're shared across API replicas. Unlike the auth rate limits (fixed
   * in code — a security-posture change belongs in a review, not a runtime
   * toggle), these are env-configurable because event-day throughput needs
   * may require live tuning without a redeploy.
   */
  RATE_LIMIT_SCAN_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_SCAN_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  /** Applies per batch request, not per scan — each batch carries up to 100 scans. */
  RATE_LIMIT_MEAL_BATCH_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MEAL_BATCH_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_SNAPSHOT_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_SNAPSHOT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

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
   * Numeric App Store ID (Adam ID) of the hackOS mobile app (H28). When set,
   * passes carry associatedStoreIdentifiers so Wallet links the pass to the
   * app (back of the pass + lock-screen suggestion); tapping it launches the
   * app via the MOBILE_APP_SCHEME deep link. Optional: unset until the app
   * has an App Store Connect record — passes then simply carry no app link.
   */
  APPLE_PASS_APP_STORE_ID: z.preprocess(
    // deploy compose files default unset vars to "" — treat that as unset
    // instead of letting z.coerce turn it into 0 and fail boot.
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),

  /**
   * Google Wallet (H28). Same "optional but never silently broken" posture
   * as Apple above — see APPLE_PASS_CERTIFICATE_PEM comment.
   */
  GOOGLE_WALLET_ISSUER_ID: z.string().optional(),
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_WALLET_PRIVATE_KEY_PEM: z.string().optional(),

  /**
   * Optional automatic translation for announcement content (H50). Entirely
   * optional — every translation surface (API and both frontends) must keep
   * working with manual-only entry when neither provider is configured; see
   * modules/notifications/translate/ for the isolated provider boundary,
   * mirroring the MAIL_PROVIDER adapter split in email-adapters/.
   */
  TRANSLATE_PROVIDER: z.enum(["google", "libretranslate"]).default("google"),
  GOOGLE_TRANSLATE_API_KEY: z.string().optional(),
  LIBRETRANSLATE_URL: z.string().optional(),
  LIBRETRANSLATE_API_KEY: z.string().optional(),
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
  dbPoolMax: parsed.DB_POOL_MAX ?? (parsed.NODE_ENV === "test" ? 5 : 20),
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
