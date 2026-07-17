import { AlertTriangleIcon, CloudOffIcon, HardDriveIcon, LoaderCircleIcon } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { useLocale } from "@/lib/i18n";

/**
 * A meal scan captured on-device and awaiting server confirmation (H25). It
 * lives in localStorage until the batch endpoint acks it, so a Wi-Fi outage or
 * a saturated server never drops or duplicates a pass.
 */
export type OfflineScan = {
  clientScanId: string;
  activityId: number;
  activityName: string;
  badgeId: string;
  allowRepeat: boolean;
  scannedAt: string;
  status: "pending" | "syncing" | "failed";
  failureKind?: "offline" | "rejected";
  error?: string;
};

const OFFLINE_KEY = "hackos:logistics:meal-scans";

export function loadOfflineQueue(): OfflineScan[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(OFFLINE_KEY) ?? "[]") as OfflineScan[];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(items: OfflineScan[]) {
  window.localStorage.setItem(OFFLINE_KEY, JSON.stringify(items));
}

/** Local, not-yet-synced meal scans queued on this device (H25). */
export function OfflineQueue({ items }: { items: OfflineScan[] }) {
  const { t } = useLocale();
  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-2">
        <p className="text-sm font-medium">{t("localQueueTitle")}</p>
      </div>
      <div className="divide-y">
        {items.map((item) => (
          <div
            key={item.clientScanId}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.activityName}</p>
              <p className="text-muted-foreground text-xs">
                {item.badgeId} · {new Date(item.scannedAt).toLocaleTimeString()}
              </p>
            </div>
            <div className="flex max-w-full flex-col items-end gap-1 text-right">
              <StatusBadge
                tone={
                  item.status === "failed"
                    ? "danger"
                    : item.failureKind === "offline"
                      ? "warning"
                      : item.status === "syncing"
                        ? "info"
                        : "neutral"
                }
              >
                {item.status === "failed" ? (
                  <AlertTriangleIcon aria-hidden className="size-3" />
                ) : item.failureKind === "offline" ? (
                  <CloudOffIcon aria-hidden className="size-3" />
                ) : item.status === "syncing" ? (
                  <LoaderCircleIcon aria-hidden className="size-3" />
                ) : (
                  <HardDriveIcon aria-hidden className="size-3" />
                )}
                {item.status === "failed"
                  ? t("scannerStateAttention")
                  : item.status === "syncing"
                    ? t("scannerStateSyncing")
                    : t("scannerStateSaved")}
              </StatusBadge>
              <p className="text-muted-foreground max-w-72 text-pretty text-xs">
                {item.status === "failed"
                  ? t("scannerBusinessRejected")
                  : item.failureKind === "offline"
                    ? t("scannerOfflineWaiting")
                    : t("scannerAwaitingAcknowledgement")}
              </p>
              {item.error ? (
                <p className="text-destructive max-w-72 text-pretty text-xs">{item.error}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
