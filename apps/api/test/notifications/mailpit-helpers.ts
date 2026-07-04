/** Thin wrapper over Mailpit's REST API (docker compose infra, localhost:8025) for asserting a real SMTP send arrived (H52). */
const MAILPIT_BASE = "http://localhost:8025";

export interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_BASE}/api/v1/messages`, { method: "DELETE" });
}

export async function listMailpitMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/messages`);
  const data = (await res.json()) as { messages?: MailpitMessageSummary[] };
  return data.messages ?? [];
}

export async function getMailpitMessage(
  id: string,
): Promise<{ Subject: string; Text: string; HTML: string }> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/message/${id}`);
  return (await res.json()) as { Subject: string; Text: string; HTML: string };
}
