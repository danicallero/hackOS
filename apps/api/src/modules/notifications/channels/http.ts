/** Shared HTTP response validation for outbound channel adapters. */
export async function assertOkResponse(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${label} send failed: ${res.status} ${body}`);
  }
}
