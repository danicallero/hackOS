import QRCode from "qrcode";
import { config } from "../../config.js";
import type { Queryable } from "../../db/pool.js";
import { hasEventAccess } from "../identity/role.js";
import { issueTicket } from "../logistics/tickets.js";
import { SupersededDispatchError } from "../notifications/errors.js";
import { type EmailPayload, normalizeLanguage } from "../notifications/templates.js";

/** H52/H28: build the ticket locally and recheck access at actual dispatch. */
export async function prepareEventReminder(
  db: Queryable,
  userId: number,
  language: string,
  payload: EmailPayload,
) {
  if (!(await hasEventAccess(db, userId)))
    throw new SupersededDispatchError("Event access revoked before reminder delivery");
  const { rows } = await db.query(
    `SELECT e.name AS event_name, e.event_starts_at, e.timezone, e.venue_name,
    u.name FROM event_config e CROSS JOIN users u
    WHERE e.id = 1 AND u.id = $1 AND NOT u.is_test_account
      AND e.event_starts_at > now()`,
    [userId],
  );
  const event = rows[0];
  if (!event?.event_name?.trim())
    throw new SupersededDispatchError("Event no longer upcoming or recipient unavailable");
  const locale = { en: "en-GB", es: "es-ES", gl: "gl-ES" }[normalizeLanguage(language)];
  const timeZone = event.timezone || "UTC";
  const eventDate = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(event.event_starts_at);
  const checkInTime = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(event.event_starts_at);
  const ticket = await issueTicket(db, userId);
  const content = await QRCode.toBuffer(ticket, {
    type: "png",
    width: 480,
    margin: 4,
    errorCorrectionLevel: "M",
  });
  return {
    payload: {
      ...payload,
      vars: {
        ...payload.vars,
        name: event.name,
        eventName: event.event_name,
        eventDate,
        checkInTime,
        venue: event.venue_name ?? "",
        walletUrl: `${config.WEB_URL}/wallet`,
        appleUrl: `${config.WEB_URL}/wallet?add=apple`,
        googleUrl: `${config.WEB_URL}/wallet?add=google`,
        ticketQr: true,
      },
    },
    attachment: {
      filename: "ticket.png",
      content,
      cid: "event-ticket@hackos",
      contentType: "image/png",
    },
  };
}
