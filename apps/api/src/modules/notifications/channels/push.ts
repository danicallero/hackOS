import type { Queryable } from "../../../db/pool.js";
import type { EmailPayload } from "../templates.js";
import { normalizeLanguage, renderEmailTemplate } from "../templates.js";

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
 */
export async function dispatchPush(
  db: Queryable,
  userId: number,
  payload: EmailPayload,
): Promise<void> {
  const { rows: tokenRows } = await db.query(`SELECT token FROM push_tokens WHERE user_id = $1`, [
    userId,
  ]);
  if (tokenRows.length === 0) return;

  const { rows: userRows } = await db.query(`SELECT language FROM users WHERE id = $1`, [userId]);
  const language = normalizeLanguage((userRows[0] as { language?: string } | undefined)?.language);
  const rendered = renderEmailTemplate(payload, language);

  const tokens: string[] = tokenRows.map((r: { token: string }) => r.token);
  const messages = tokens.map((token) => ({
    to: token,
    title: rendered.subject,
    body: rendered.text,
    data: payload.vars ?? {},
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
  for (let i = 0; i < tickets.length; i += 1) {
    const ticket = tickets[i];
    if (!ticket || ticket.status === "ok") continue;
    if (ticket.details?.error === "DeviceNotRegistered") {
      await db.query(`DELETE FROM push_tokens WHERE token = $1`, [tokens[i]]);
      continue;
    }
    firstError ??= ticket.message ?? ticket.details?.error ?? "unknown expo push error";
  }
  if (firstError) throw new Error(`Expo push ticket error: ${firstError}`);
}
