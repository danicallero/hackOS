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
 * Thin wrapper around the Better Auth client's underlying fetch
 * (`authClient.$fetch`, powered by better-fetch) so every authenticated call
 * to the hackOS API — not just the /api/auth/* endpoints Better Auth itself
 * exposes — carries the session Cookie header `expoClient` restores from
 * `expo-secure-store`. Throws on non-2xx so callers can rely on try/catch.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError(`API path must be root-relative: ${path}`);
  }

  // Better Auth appends its own /api/auth base path to relative requests.
  // Our application endpoints live alongside that mount, so give $fetch an
  // absolute same-origin URL. The Expo fetch plugin still runs and attaches
  // the restored session cookie and mobile-origin headers.
  const url = `${API_URL.replace(/\/+$/, "")}${path}`;
  const method = init?.method?.toUpperCase() ?? "GET";
  const { data, error } = await authClient.$fetch<T>(url, {
    method: init?.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined,
    body: init?.body,
    headers: init?.headers as Record<string, string> | undefined,
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
