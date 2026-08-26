import { authClient } from "./auth-client";
import { API_URL } from "./env";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * A device clock running ahead of the server's causes otherwise-valid
 * offline scans (H25) to be rejected as "in the future" — see
 * apps/api/src/lib/clock.ts CLOCK_SKEW_TOLERANCE_MS. Every response carries
 * a standard `Date` header, so we track the observed skew here without a
 * dedicated time endpoint.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

let clockSkewMs: number | null = null;

export function getClockSkewMs(): number | null {
  return clockSkewMs;
}

function recordServerDate(response: Response): void {
  const header = response.headers.get("date");
  if (!header) return;
  const serverTime = Date.parse(header);
  if (Number.isNaN(serverTime)) return;
  clockSkewMs = serverTime - Date.now();
}

export type ApiFetchInit = RequestInit & {
  /**
   * Binds a request to the session captured by an operation that may outlive
   * an account switch on a shared device. This is consumed locally and is
   * never forwarded as an application header.
   */
  sessionCookie?: string;
};

/**
 * Thin wrapper around the Better Auth client's underlying fetch
 * (`authClient.$fetch`, powered by better-fetch) so every authenticated call
 * to the hackOS API — not just the /api/auth/* endpoints Better Auth itself
 * exposes — carries the session Cookie header `expoClient` restores from
 * `expo-secure-store`. Throws on non-2xx so callers can rely on try/catch.
 */
export async function apiFetch<T>(path: string, init?: ApiFetchInit): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError(`API path must be root-relative: ${path}`);
  }

  const { sessionCookie, ...requestInit } = init ?? {};

  // Better Auth appends its own /api/auth base path to relative requests.
  // Our application endpoints live alongside that mount, so give $fetch an
  // absolute same-origin URL. The Expo fetch plugin still runs and attaches
  // the restored session cookie and mobile-origin headers.
  const url = `${API_URL.replace(/\/+$/, "")}${path}`;
  const method = requestInit.method?.toUpperCase() ?? "GET";
  const { data, error } = await authClient.$fetch<T>(url, {
    method: requestInit.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined,
    body: requestInit.body,
    headers: requestInit.headers as Record<string, string> | undefined,
    // The Expo plugin's init hook runs before Better Fetch's request hooks
    // and normally reads whichever cookie is in SecureStore at that moment.
    // Override it at the last point before transport so an in-flight scanner
    // replay cannot switch staff identity between account sessions.
    onRequest:
      sessionCookie === undefined
        ? undefined
        : ({ headers }) => {
            headers.set("cookie", sessionCookie);
          },
    onResponse: (context) => recordServerDate(context.response),
    onError: (context) => recordServerDate(context.response),
    // Reads can safely ride through the short origin gap during a Dokploy
    // replacement. Do not automatically retry non-idempotent writes.
    retry:
      method === "GET"
        ? {
            type: "exponential",
            attempts: 4,
            baseDelay: 500,
            maxDelay: 4_000,
            shouldRetry: (response) =>
              response === null || [502, 503, 504].includes(response.status),
          }
        : undefined,
  });
  if (error) {
    const envelope = error as {
      error?: { code?: string; message?: string; details?: unknown };
      message?: string;
    };
    throw new ApiError(
      envelope.error?.message ?? envelope.message ?? `Request to ${path} failed (${error.status})`,
      error.status,
      envelope.error?.code,
      envelope.error?.details,
    );
  }
  return data as T;
}
