/** Shared HTTP response validation for outbound channel adapters. */
export async function assertOkResponse(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    // Provider bodies can echo recipients, message fragments, or request
    // identifiers. They are persisted by the notification dispatcher in
    // `last_error`, so retain only the status needed for retry diagnosis.
    await res.body?.cancel().catch(() => {});
    throw new Error(`${label} send failed: ${res.status}`);
  }
}
