import type { Queryable } from "../../../db/pool.js";
import type { EmailPayload } from "../templates.js";
import { normalizeLanguage, renderPushTemplate } from "../templates.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
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
  const { rows: tokenRows } = await db.query(`SELECT token FROM push_tokens WHERE user_id = $1`, [
    userId,
  ]);
  if (tokenRows.length === 0) return;

  const { rows: userRows } = await db.query(`SELECT language FROM users WHERE id = $1`, [userId]);
  const language = normalizeLanguage((userRows[0] as { language?: string } | undefined)?.language);
  const rendered = renderPushTemplate(payload, language);

  // `category`/`template` ride alongside the template vars so the mobile app
  // can route a tap (e.g. queue.called -> queue tab) or trigger an immediate
  // foreground refetch without having to guess from the vars shape alone.
  const data = { ...(payload.vars ?? {}), category, template: payload.template };
  const timeSensitive =
    category === "queue"
      ? {
          priority: "high" as const,
          interruptionLevel: "time-sensitive" as const,
          sound: "default" as const,
        }
      : {};

  const tokens: string[] = tokenRows.map((r: { token: string }) => r.token);
  const messages = tokens.map((token) => ({
    to: token,
    title: rendered.title,
    body: rendered.body,
    data,
    ...timeSensitive,
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Expo push send failed: ${res.status} ${body}`);
  }

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
    firstError ??= ticket.message ?? ticket.details?.error ?? "unknown expo push error";
  }
  // The outbox retries a failed row by resending to every current token
  // again (no per-token retry tracking), so a batch counts as delivered as
  // soon as ANY device got it — otherwise a single flaky/rate-limited ticket
  // re-triggers the whole batch and spams the devices that already got it.
  if (firstError && delivered === 0) throw new Error(`Expo push ticket error: ${firstError}`);
}
