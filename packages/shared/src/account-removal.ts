export type AccountRemovalAction = "delete" | "anonymize";

export type AccountRemovalProgressStatus = "pending_exit" | "processing" | "device_cleanup_pending";

export interface AccountRemovalProgress {
  action: AccountRemovalAction;
  status: AccountRemovalProgressStatus;
}

/** H54: parse only the non-identifying progress marker, dropping extra fields. */
export function parseAccountRemovalProgress(raw: string | null): AccountRemovalProgress | null {
  try {
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (
      (value.action !== "delete" && value.action !== "anonymize") ||
      (value.status !== "pending_exit" &&
        value.status !== "processing" &&
        value.status !== "device_cleanup_pending")
    )
      return null;
    return { action: value.action, status: value.status };
  } catch {
    return null;
  }
}
