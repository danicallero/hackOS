import { authClient } from "./auth-client";

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
  const { data, error } = await authClient.$fetch<T>(path, {
    method: init?.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined,
    body: init?.body,
    headers: init?.headers as Record<string, string> | undefined,
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
