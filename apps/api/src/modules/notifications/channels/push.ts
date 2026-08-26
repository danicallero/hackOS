import type { Queryable } from "../../../db/pool.js";
import { QUEUE_CATEGORY, QUEUE_STAFF_CATEGORY } from "../service.js";
import type { EmailPayload } from "../templates.js";
import { normalizeLanguage, renderPushTemplate } from "../templates.js";
import { assertOkResponse } from "./http.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

interface PushTokenRow {
  token: string;
  platform: string | null;
}

function tokenLabel(token: string): string {
  return token.length > 10 ? `…${token.slice(-8)}` : token;
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
    `SELECT token, platform FROM push_tokens WHERE user_id = $1`,
    [userId],
  );
  if (tokenRows.length === 0) return;

  const { rows: userRows } = await db.query(`SELECT language FROM users WHERE id = $1`, [userId]);
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

  // undici surfaces network/DNS failures as a bare `TypeError: fetch failed`
  // whose real reason (EAI_AGAIN, ECONNRESET, timeout, …) lives on `.cause`.
  // Unwrap it so the outbox `last_error` names the actual failure instead of
  // an opaque "fetch failed" that hides e.g. a container DNS misconfiguration.
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(messages),
  }).catch((err: unknown) => {
    const cause = err instanceof Error ? err.cause : undefined;
    const detail =
      cause instanceof Error ? cause.message : cause ? String(cause) : (err as Error)?.message;
    throw new Error(`Expo push request failed: ${detail ?? "unknown network error"}`);
  });
  await assertOkResponse(res, "Expo push");

  const json = (await res.json()) as { data?: ExpoTicket[] };
  const tickets = json.data ?? [];

  let firstError: string | undefined;
  let delivered = 0;
  for (let i = 0; i < tickets.length; i += 1) {
    const ticket = tickets[i];
    if (!ticket || ticket.status === "ok") {
      delivered += 1;
      continue;
    }
    if (ticket.details?.error === "DeviceNotRegistered") {
      await db.query(`DELETE FROM push_tokens WHERE token = $1`, [tokens[i]]);
      continue;
    }
    const error = ticket.message ?? ticket.details?.error ?? "unknown expo push error";
    console.warn("Expo push ticket failed", {
      userId,
      category,
      platform: typedTokenRows[i]?.platform ?? "unknown",
      token: tokenLabel(tokens[i] ?? "unknown"),
      error,
    });
    firstError ??= error;
  }
  // The outbox retries a failed row by resending to every current token
  // again (no per-token retry tracking), so a batch counts as delivered as
  // soon as ANY device got it — otherwise a single flaky/rate-limited ticket
  // re-triggers the whole batch and spams the devices that already got it.
  if (firstError && delivered === 0) throw new Error(`Expo push ticket error: ${firstError}`);
}
