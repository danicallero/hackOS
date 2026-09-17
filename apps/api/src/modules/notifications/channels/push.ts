import { config } from "../../../config.js";
import type { Queryable } from "../../../db/pool.js";
import { QUEUE_CATEGORY, QUEUE_STAFF_CATEGORY } from "../service.js";
import type { EmailPayload } from "../templates.js";
import { normalizeLanguage, renderPushTemplate } from "../templates.js";
import { assertOkResponse } from "./http.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const EXPO_RECEIPT_POLL_DELAYS_MS = [0, 1_000, 3_000] as const;

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string; [key: string]: unknown };
}

interface ExpoReceiptsResponse {
  data?: Record<string, ExpoReceipt>;
  errors?: unknown;
}

interface PushTokenRow {
  token: string;
  platform: string | null;
}

function stringifyUnsafe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

async function fetchExpoReceipts(
  ticketIds: string[],
  userId: number,
  category?: string,
): Promise<Record<string, ExpoReceipt>> {
  const pending = new Set(ticketIds);
  const receipts: Record<string, ExpoReceipt> = {};

  for (const delayMs of EXPO_RECEIPT_POLL_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    if (pending.size === 0) break;

    const ids = [...pending];
    if (config.logExpoPushUnsafeDebug) {
      console.warn(
        "Expo push receipt request (unsafe debug)",
        stringifyUnsafe({ userId, category, ids }),
      );
    }

    let res: Response;
    try {
      res = await fetch(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch (err: unknown) {
      if (config.logExpoPushUnsafeDebug) {
        console.error(
          "Expo push receipt request failed (unsafe debug)",
          stringifyUnsafe({
            userId,
            category,
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, cause: err.cause }
                : err,
          }),
        );
      } else if (config.logExpoPushTickets) {
        console.warn("Expo push receipt lookup failed", {
          category,
          errorCode: "request_failed",
        });
      }
      return receipts;
    }

    if (!res.ok) {
      const body = await res
        .clone()
        .text()
        .catch(() => "<unreadable response body>");
      if (config.logExpoPushUnsafeDebug) {
        console.error(
          "Expo push receipt HTTP response (unsafe debug)",
          stringifyUnsafe({ userId, category, status: res.status, body }),
        );
      } else if (config.logExpoPushTickets) {
        console.warn("Expo push receipt lookup failed", {
          category,
          status: res.status,
          errorCode: "http_error",
        });
      }
      return receipts;
    }

    const json = ((await res.json()) as ExpoReceiptsResponse | null) ?? {};
    if (config.logExpoPushUnsafeDebug) {
      console.warn(
        "Expo push receipts (unsafe debug)",
        stringifyUnsafe({ userId, category, response: json }),
      );
    }

    if (!json.data || Array.isArray(json.data) || typeof json.data !== "object") {
      return receipts;
    }

    for (const [ticketId, receipt] of Object.entries(json.data)) {
      if (!receipt) continue;
      receipts[ticketId] = receipt;
      pending.delete(ticketId);
    }
  }

  if (pending.size > 0) {
    if (config.logExpoPushUnsafeDebug) {
      console.warn(
        "Expo push receipts pending (unsafe debug)",
        stringifyUnsafe({ userId, category, ticketIds: [...pending] }),
      );
    } else if (config.logExpoPushTickets) {
      console.info("Expo push receipts pending", {
        category,
        ticketIds: [...pending],
      });
    }
  }

  return receipts;
}

/**
 * Expo Push adapter (H51, H55). Sends to every registered push_token of the
 * user in one batched request. A user with zero tokens is a no-op success —
 * they simply haven't installed/opened the mobile app, which isn't a
 * transient failure worth retrying 8 times. `DeviceNotRegistered` tickets
 * mean the token is stale (uninstalled, etc.) and are cleaned up here so the
 * next attempt doesn't keep hitting a dead token.
 *
 * The outbox dispatcher retries a whole row by calling this again, which
 * resends to ALL of the user's current tokens (there's no per-token retry
 * state). So a batch only throws — and gets retried — when NOT A SINGLE
 * token was delivered; a partial failure (e.g. one token rate-limited while
 * others succeeded) is treated as delivered so already-notified devices
 * don't get the same push resent on every backoff retry.
 */
export async function dispatchPush(
  db: Queryable,
  userId: number,
  payload: EmailPayload,
  category?: string,
): Promise<void> {
  const { rows: tokenRows } = await db.query(
    `SELECT pt.token, pt.platform
       FROM push_tokens pt
       JOIN users u ON u.id = pt.user_id
      WHERE pt.user_id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
    [userId],
  );
  if (tokenRows.length === 0) return;

  const { rows: userRows } = await db.query(
    `SELECT language FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  const language = normalizeLanguage((userRows[0] as { language?: string } | undefined)?.language);
  const rendered = renderPushTemplate(payload, language);

  // `category`/`template` ride alongside the template vars so the mobile app
  // can route a tap (e.g. queue.called -> queue tab) or trigger an immediate
  // foreground refetch without having to guess from the vars shape alone.
  const data = { ...(payload.vars ?? {}), category, template: payload.template };
  const timeSensitive =
    category === QUEUE_CATEGORY || category === QUEUE_STAFF_CATEGORY
      ? {
          priority: "high" as const,
          interruptionLevel: "time-sensitive" as const,
          sound: "default" as const,
        }
      : {};

  const typedTokenRows = tokenRows as PushTokenRow[];
  const tokens = typedTokenRows.map((row) => row.token);
  const messages = tokens.map((token) => ({
    to: token,
    title: rendered.title,
    body: rendered.body,
    data,
    channelId: "default",
    ...timeSensitive,
  }));

  if (config.logExpoPushUnsafeDebug) {
    console.warn(
      "Expo push request (unsafe debug)",
      stringifyUnsafe({ userId, category, payload, messages }),
    );
  }

  // undici surfaces network/DNS failures as a bare `TypeError: fetch failed`
  // whose real reason (EAI_AGAIN, ECONNRESET, timeout, …) lives on `.cause`.
  // Unwrap it so the outbox `last_error` names the actual failure instead of
  // an opaque "fetch failed" that hides e.g. a container DNS misconfiguration.
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(messages),
  }).catch((err: unknown) => {
    if (config.logExpoPushUnsafeDebug) {
      console.error(
        "Expo push request failed (unsafe debug)",
        stringifyUnsafe({
          userId,
          category,
          error:
            err instanceof Error ? { name: err.name, message: err.message, cause: err.cause } : err,
        }),
      );
    }
    // The error is persisted by the outbox dispatcher. Do not copy a provider
    // exception, token, URL, or request body into that durable history.
    void err;
    throw new Error("Expo push request failed");
  });
  if (!res.ok && config.logExpoPushUnsafeDebug) {
    console.error("Expo push HTTP response (unsafe debug)", {
      userId,
      category,
      status: res.status,
      body: await res
        .clone()
        .text()
        .catch(() => "<unreadable response body>"),
    });
  }
  await assertOkResponse(res, "Expo push");

  const json = (await res.json()) as { data?: ExpoTicket[] };
  if (config.logExpoPushUnsafeDebug) {
    console.warn(
      "Expo push response (unsafe debug)",
      stringifyUnsafe({ userId, category, response: json }),
    );
  }
  const tickets = json.data ?? [];

  let firstError: string | undefined;
  let delivered = 0;
  const ticketMetadata = new Map<string, { platform: string; token: string }>();
  for (let i = 0; i < tickets.length; i += 1) {
    const ticket = tickets[i];
    if (!ticket) {
      if (config.logExpoPushTickets) {
        console.warn("Expo push ticket missing", {
          category,
          platform: typedTokenRows[i]?.platform ?? "unknown",
        });
      }
      continue;
    }
    if (ticket.id) {
      ticketMetadata.set(ticket.id, {
        platform: typedTokenRows[i]?.platform ?? "unknown",
        token: tokens[i]!,
      });
    }
    if (ticket.status === "ok") {
      if (config.logExpoPushTickets) {
        console.info("Expo push ticket", {
          category,
          platform: typedTokenRows[i]?.platform ?? "unknown",
          status: ticket.status,
          ticketId: ticket.id ?? null,
        });
      }
      delivered += 1;
      continue;
    }
    const errorCode = ticket.details?.error ?? "provider_error";
    const ticketLog = {
      category,
      platform: typedTokenRows[i]?.platform ?? "unknown",
      errorCode,
      ...(ticket.id ? { ticketId: ticket.id } : {}),
    };
    if (config.logExpoPushTickets) console.warn("Expo push ticket failed", ticketLog);
    if (errorCode === "DeviceNotRegistered") {
      await db.query(`DELETE FROM push_tokens WHERE token = $1`, [tokens[i]]);
      continue;
    }
    firstError ??= errorCode;
  }

  if (ticketMetadata.size > 0 && (config.logExpoPushTickets || config.logExpoPushUnsafeDebug)) {
    const receipts = await fetchExpoReceipts([...ticketMetadata.keys()], userId, category);
    for (const [ticketId, receipt] of Object.entries(receipts)) {
      const metadata = ticketMetadata.get(ticketId);
      if (!metadata) continue;
      if (receipt.status === "error") {
        const errorCode = receipt.details?.error ?? "provider_error";
        if (config.logExpoPushTickets) {
          console.warn("Expo push receipt failed", {
            category,
            platform: metadata.platform,
            ticketId,
            errorCode,
          });
        }
        if (errorCode === "DeviceNotRegistered") {
          await db.query(`DELETE FROM push_tokens WHERE token = $1`, [metadata.token]);
        }
      } else if (config.logExpoPushTickets) {
        console.info("Expo push receipt", {
          category,
          platform: metadata.platform,
          status: receipt.status,
          ticketId,
        });
      }
    }
  }

  // The outbox retries a failed row by resending to every current token
  // again (no per-token retry tracking), so a batch counts as delivered as
  // soon as ANY device got it — otherwise a single flaky/rate-limited ticket
  // re-triggers the whole batch and spams the devices that already got it.
  if (firstError && delivered === 0) throw new Error(`Expo push ticket error: ${firstError}`);
}
