import { type ApiFetchInit, apiFetch } from "./api";

/** H22–H26: an unresponsive transport must eventually yield to the local queue. */
export async function scannerFetch<T>(path: string, init?: ApiFetchInit): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      apiFetch<T>(path, { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new TypeError("Scanner request timed out"));
          controller.abort();
        }, 5_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
