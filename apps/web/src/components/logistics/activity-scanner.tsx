"use client";

import { EVENTS } from "@hackos/shared/events";
import { ActivityIcon, RepeatIcon, ScanLineIcon, SoupIcon, UsersIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLiveQuery } from "@/hooks/use-event-source";
import { type ActivityScanResult, logisticsApi } from "@/lib/logistics";
import {
  loadOfflineQueue,
  OfflineQueue,
  type OfflineScan,
  saveOfflineQueue,
} from "./offline-queue";
import { ScanResult } from "./scan-result";
import { errorMessage, Field, InlineError } from "./ui";

const SCAN_EVENTS = [EVENTS.LOGISTICS_ACTIVITY_SCAN, EVENTS.LOGISTICS_MEAL_SCAN_BATCH];

/**
 * Meal (H25) / registrable-activity (H26) scanner station. Sources its list
 * from `/api/activities/scannable` — available to ACTIVITY_SCAN operators, so
 * the picker and its inline counts work without the LOGISTICS_STATS capability.
 * Meals additionally support an on-device offline queue.
 */
export function ActivityScannerCard({ category }: { category: "meal" | "activity" }) {
  const isMeal = category === "meal";
  const activities = useLiveQuery(
    () => logisticsApi.scannableActivities(category),
    "/api/logistics/stream",
    SCAN_EVENTS,
    { debounceMs: 400 },
  );
  const items = useMemo(() => activities.data?.items ?? [], [activities.data]);

  const [activityId, setActivityId] = useState("");
  const [badgeId, setBadgeId] = useState("");
  const [allowRepeat, setAllowRepeat] = useState(false);
  const [result, setResult] = useState<ActivityScanResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState<OfflineScan[]>([]);
  const selected = items.find((a) => String(a.activityId) === activityId) ?? null;

  useEffect(() => {
    if (isMeal) setOffline(loadOfflineQueue());
  }, [isMeal]);

  const persistOffline = (next: OfflineScan[]) => {
    setOffline(next);
    saveOfflineQueue(next);
  };

  const scanNow = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const scan = await logisticsApi.activityScan(selected.activityId, {
        badgeId: badgeId.trim(),
        allowRepeat,
      });
      setResult(scan);
      toast.success(scan.firstTime ? "Scan registered." : "Repeat registered.");
      setBadgeId("");
      setAllowRepeat(false);
      activities.refetch();
    } catch (err) {
      setError(errorMessage(err, "Scan failed."));
    } finally {
      setBusy(false);
    }
  };

  const queueOffline = () => {
    if (!selected) return;
    persistOffline([
      ...offline,
      {
        clientScanId: crypto.randomUUID(),
        activityId: selected.activityId,
        activityName: selected.name,
        badgeId: badgeId.trim(),
        allowRepeat,
        scannedAt: new Date().toISOString(),
        status: "pending",
      },
    ]);
    setBadgeId("");
    setAllowRepeat(false);
    toast.success("Scan queued locally.");
  };

  const syncOffline = async () => {
    const groups = new Map<number, OfflineScan[]>();
    for (const item of offline.filter((scan) => scan.status !== "syncing")) {
      groups.set(item.activityId, [...(groups.get(item.activityId) ?? []), item]);
    }
    if (groups.size === 0) return;
    setBusy(true);
    let next: OfflineScan[] = offline.map((scan) => ({ ...scan, status: "syncing" }));
    persistOffline(next);
    for (const [id, scans] of groups) {
      try {
        await logisticsApi.mealBatch(id, {
          deviceId: "web-scanner",
          scans: scans.map((scan) => ({
            clientScanId: scan.clientScanId,
            badgeId: scan.badgeId,
            allowRepeat: scan.allowRepeat,
            scannedAt: scan.scannedAt,
          })),
        });
        next = next.filter(
          (scan) => !scans.some((sent) => sent.clientScanId === scan.clientScanId),
        );
      } catch (err) {
        const message = errorMessage(err, "Offline sync failed.");
        next = next.map((scan) =>
          scans.some((sent) => sent.clientScanId === scan.clientScanId)
            ? { ...scan, status: "failed", error: message }
            : scan,
        );
      }
      persistOffline(next);
    }
    setBusy(false);
    activities.refetch();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={isMeal ? "Servings" : "Scans"}
          value={selected ? selected.count : "—"}
          icon={isMeal ? SoupIcon : ActivityIcon}
          hint={selected ? selected.name : "Select to see counts"}
        />
        <StatCard
          label="People"
          value={selected ? selected.distinctPeople : "—"}
          icon={UsersIcon}
          hint="Distinct attendees"
        />
        <StatCard
          label="Repeats"
          value={selected ? selected.repeats : "—"}
          icon={RepeatIcon}
          hint={activities.connected ? "Live" : "Reconnects automatically"}
        />
      </div>

      <SectionCard
        title={isMeal ? "Meal line" : "Activity door"}
        description={
          isMeal
            ? "Scan each badge as it passes. Repeats need explicit confirmation."
            : "Scan badges at the entrance of a registrable activity."
        }
        icon={ScanLineIcon}
        bodyClassName="space-y-5"
      >
        {activities.loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={isMeal ? SoupIcon : ActivityIcon}
            title={isMeal ? "No meals defined yet" : "No registrable activities yet"}
            description={
              isMeal
                ? "Meals are created in schedule management."
                : "Mark activities as requires-scan in schedule management."
            }
          />
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)_140px_140px]">
              <Field label="Activity">
                <Select value={activityId} onValueChange={setActivityId}>
                  <SelectTrigger>
                    <SelectValue placeholder={isMeal ? "Choose meal" : "Choose activity"} />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((activity) => (
                      <SelectItem key={activity.activityId} value={String(activity.activityId)}>
                        {activity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Badge">
                <Input
                  value={badgeId}
                  onChange={(e) => setBadgeId(e.target.value)}
                  placeholder="scan badge"
                  autoComplete="off"
                />
              </Field>
              <div className="flex items-end">
                <Button
                  variant={allowRepeat ? "default" : "outline"}
                  className="w-full"
                  onClick={() => setAllowRepeat((v) => !v)}
                >
                  {allowRepeat ? "Repeat on" : "No repeat"}
                </Button>
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={scanNow}
                  disabled={busy || !activityId || !badgeId.trim()}
                >
                  <ScanLineIcon className="size-4" />
                  Scan
                </Button>
              </div>
            </div>

            {error && <InlineError message={error} />}
            {result && <ScanResult result={result} />}

            {isMeal && (
              <>
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={queueOffline}
                    disabled={!activityId || !badgeId.trim()}
                  >
                    Queue locally
                  </Button>
                  <Button
                    variant="outline"
                    onClick={syncOffline}
                    disabled={busy || offline.length === 0}
                  >
                    Sync {offline.length} pending
                  </Button>
                  {offline.length > 0 && (
                    <Button variant="ghost" onClick={() => persistOffline([])} disabled={busy}>
                      Clear local queue
                    </Button>
                  )}
                </div>
                {offline.length > 0 && <OfflineQueue items={offline} />}
              </>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}
