import { isMaintenanceError, maintenancePhaseOf } from "@hackos/shared/maintenance";
import { API_URL } from "./env";
import { intentKey, settleIntentKey } from "./intent-key";
import { maintenanceStore } from "./maintenance";

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

interface SharedGet {
  promise: Promise<unknown>;
  controller: AbortController;
  subscribers: number;
  shared: boolean;
}
/** Identical GETs that are in flight at the same moment (#1227). Nothing is kept after they settle. */
const inflightGets = new Map<string, SharedGet>();

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Concurrent identical GETs (same URL, credentials and cache mode) share one
 * network request, so components that mount together and ask for the same
 * resource no longer each hit the API. Each caller still gets its own copy of
 * the result and its own abort: the request is cancelled only when every
 * caller has aborted.
 */
function coalescedGet<T>(path: string, options: RequestOptions): Promise<T> {
  const { signal, ...rest } = options;
  if (signal?.aborted) return Promise.reject(abortError(signal));
  const key = `${buildUrl(path, rest.query)}|${rest.credentials ?? ""}|${rest.cache ?? ""}`;
  let entry = inflightGets.get(key);
  if (entry) {
    entry.shared = true;
  } else {
    const controller = new AbortController();
    const created: SharedGet = {
      controller,
      subscribers: 0,
      shared: false,
      promise: performFetch<T>(path, { ...rest, signal: controller.signal }).finally(() => {
        if (inflightGets.get(key) === created) inflightGets.delete(key);
      }),
    };
    entry = created;
    inflightGets.set(key, created);
  }
  const current = entry;
  current.subscribers += 1;
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const release = () => {
      current.subscribers -= 1;
      if (current.subscribers === 0 && inflightGets.get(key) === current) {
        inflightGets.delete(key);
        current.controller.abort();
      }
    };
    const onAbort = () => {
      if (done) return;
      done = true;
      release();
      reject(abortError(signal as AbortSignal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    current.promise.then(
      (value) => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", onAbort);
        current.subscribers -= 1;
        resolve((current.shared ? structuredClone(value) : value) as T);
      },
      (error) => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", onAbort);
        current.subscribers -= 1;
        reject(error);
      },
    );
  });
}

/**
 * Single entry point for every hackOS API call. Public reads omit cookies so
 * they remain usable from any origin; every other request carries the session
 * cookie and stays within the deployment's credentialed CORS boundary.
 */
async function performFetch<T>(path: string, options: RequestOptions): Promise<T> {
  const { body, query, headers, credentials: requestedCredentials, ...rest } = options;
  const method = rest.method?.toUpperCase() ?? "GET";
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const isPublicRead = path.startsWith("/api/public/") && (method === "GET" || method === "HEAD");
  const intent =
    isMutation && !new Headers(headers).has("Idempotency-Key")
      ? `${method} ${path} ${JSON.stringify(body ?? null)}`
      : null;
  // A transport failure throws before settling, which keeps the key for the retry.
  const res = await fetch(buildUrl(path, query), {
    credentials: requestedCredentials ?? (isPublicRead ? "omit" : "include"),
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(intent ? { "Idempotency-Key": intentKey(intent) } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...rest,
  });
  if (intent) settleIntentKey(intent, res.status);

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
    if (isMaintenanceError(res.status, err?.code)) {
      maintenanceStore.mark(maintenancePhaseOf(err?.details));
    }
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

export function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const isGet = (options.method?.toUpperCase() ?? "GET") === "GET";
  if (isGet && options.body === undefined && !options.headers) {
    return coalescedGet<T>(path, options);
  }
  return performFetch<T>(path, options);
}

/**
 * Like `apiFetch`, but for a multipart file upload — `apiFetch` always
 * JSON-stringifies its body, which can't carry a `FormData` payload.
 */
export async function apiUpload<T = unknown>(path: string, body: FormData): Promise<T> {
  const intent = `POST ${path} ${[...body.entries()]
    .map(([name, value]) =>
      value instanceof File
        ? `${name}:${value.name}:${value.size}:${value.lastModified}`
        : `${name}:${value}`,
    )
    .join("|")}`;
  const res = await fetch(buildUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Idempotency-Key": intentKey(intent) },
    body,
  });
  settleIntentKey(intent, res.status);

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? res.statusText ?? "Request failed",
      err?.details,
    );
  }

  return payload as T;
}

/**
 * Download an authenticated API file (CSV, SVG, zip) and save it under the
 * name from its `content-disposition`, or `fallbackName`. Errors use the same
 * `ApiError` envelope as `apiFetch`.
 */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(buildUrl(path), { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    throw new ApiError(
      res.status,
      payload?.error?.code ?? "unknown",
      payload?.error?.message ?? res.statusText ?? "Download failed",
      payload?.error?.details,
    );
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
