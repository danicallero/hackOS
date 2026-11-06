import { errorMessage } from "@/components/logistics/ui";
import type { Translate } from "@/lib/i18n";

export function hoursSince(iso: string, t: Translate): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? t("presenceLessThanHourAgo") : t("presenceHoursAgo", { hours: Math.round(h) });
}

export function queryLoadError(
  error: unknown,
  t: Translate,
  fallback: string,
  onRetry: () => void,
): { message: string; onRetry: () => void } | undefined {
  return error ? { message: errorMessage(error, t, fallback), onRetry } : undefined;
}
