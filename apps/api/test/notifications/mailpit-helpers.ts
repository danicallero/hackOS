/** Mailpit REST assertions use the same isolated inbox as the SMTP target (H52). */
export const MAILPIT_BASE = process.env.TEST_MAILPIT_URL ?? "http://localhost:8025";

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

export async function getMailpitMessage(id: string): Promise<{
  Subject: string;
  Text: string;
  HTML: string;
  From: { Address: string; Name: string };
  ReplyTo: { Address: string }[];
}> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/message/${id}`);
  return (await res.json()) as {
    Subject: string;
    Text: string;
    HTML: string;
    From: { Address: string; Name: string };
    ReplyTo: { Address: string }[];
  };
}
