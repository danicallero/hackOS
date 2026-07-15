import { API_URL } from "./env";

/**
 * Typed error mirroring the API's error envelope
 * (`{ error: { code, message, details } }`, apps/api/src/lib/errors.ts).
 * UI code catches this to show the server's business-error message verbatim.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Json = Record<string, unknown> | unknown[];

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: Json;
  /** Query string params; undefined/null values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path.startsWith("http") ? path : `${API_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Single entry point for every hackOS API call. Always credentialed (session
 * cookie), always JSON, always surfaces the API's error envelope as ApiError.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, query, headers, ...rest } = options;
  const res = await fetch(buildUrl(path, query), {
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...rest,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    if (
      res.status === 409 &&
      payload &&
      typeof payload === "object" &&
      "registered" in payload &&
      (payload as { registered?: unknown }).registered === false
    ) {
      throw new ApiError(
        res.status,
        "repeat_confirmation_required",
        (payload as { message?: string }).message ?? "Confirmation required",
        payload,
      );
    }
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    throw new ApiError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? res.statusText ?? "Request failed",
      err?.details,
      retryAfter,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: Json, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: Json, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH", body }),
  put: <T>(path: string, body?: Json, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "DELETE" }),
};
