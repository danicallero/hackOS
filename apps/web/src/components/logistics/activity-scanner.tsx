"use client";

import { EVENTS } from "@hackos/shared/events";
import {
  ActivityIcon,
  CheckCircleIcon,
  HardDriveIcon,
  RepeatIcon,
  ScanLineIcon,
  SearchIcon,
  SoupIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLiveQuery } from "@/hooks/use-event-source";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type ActivityScanResult, logisticsApi, type PersonSearchResult } from "@/lib/logistics";
import { useSessionContext } from "@/lib/session";
import {
  clearOfflineQueue,
  isStaleOfflineScanError,
  loadOfflineQueue,
  OfflineQueue,
  type OfflineScan,
  saveOfflineQueue,
} from "./offline-queue";
import { PersonSearchResults } from "./person-search-results";
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
  const { t } = useLocale();
  const { me } = useSessionContext();
  const isMeal = category === "meal";
  const ownerId = me?.id ?? null;
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  const activities = useLiveQuery(
    () => logisticsApi.scannableActivities(category),
    "/api/logistics/stream",
    SCAN_EVENTS,
    { debounceMs: 400 },
  );
  const items = useMemo(() => activities.data?.items ?? [], [activities.data]);

  const [activityId, setActivityId] = useState("");
  const [badgeId, setBadgeId] = useState("");
  const [repeatPrompt, setRepeatPrompt] = useState<ActivityScanResult | null>(null);
  const [result, setResult] = useState<ActivityScanResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState<OfflineScan[]>([]);
  const [queueReady, setQueueReady] = useState(!isMeal);
  const [transactionState, setTransactionState] = useState<
    "ready" | "saved" | "confirmed" | "attention"
  >("ready");
  const selected = items.find((a) => String(a.activityId) === activityId) ?? null;

  useEffect(() => {
    let active = true;
    if (!isMeal || ownerId === null) {
      setOffline([]);
      setQueueReady(!isMeal);
      return () => {
        active = false;
      };
    }
    setQueueReady(false);
    void loadOfflineQueue(ownerId)
      .then((items) => {
        if (active) setOffline(items);
      })
      .catch(() => {
        if (active) setOffline([]);
      })
      .finally(() => {
        if (active) setQueueReady(true);
      });
    return () => {
      active = false;
    };
  }, [isMeal, ownerId]);

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResults, setFindResults] = useState<PersonSearchResult[] | null>(null);
  const [findBusy, setFindBusy] = useState(false);
  const [findError, setFindError] = useState("");

  const doFind = async () => {
    const q = findQuery.trim();
    if (!q) return;
    setFindBusy(true);
    setFindError("");
    try {
      const { results } = await logisticsApi.searchPeople(q, ["email", "badgeId", "confirmed"]);
      setFindResults(results);
    } catch (err) {
      setFindResults(null);
      setFindError(errorMessage(err, t("userSearchFailed")));
    } finally {
      setFindBusy(false);
    }
  };

  const pickFound = (person: PersonSearchResult) => {
    if (!person.badgeId) {
      toast.error(t("noBadge"));
      return;
    }
    setBadgeId(person.badgeId);
    setFindOpen(false);
    setFindQuery("");
    setFindResults(null);
    setFindError("");
  };

  const persistOffline = async (next: OfflineScan[]) => {
    if (ownerId === null || ownerRef.current !== ownerId) {
      throw new Error("The authenticated staff owner changed");
    }
    await saveOfflineQueue(ownerId, next);
    setOffline(next);
  };

  const persistSyncedQueue = async (next: OfflineScan[]): Promise<boolean> => {
    if (ownerRef.current !== ownerId) return false;
    try {
      await persistOffline(next);
      return true;
    } catch {
      // Do not leave an old encrypted snapshot that can replay a credential
      // after the server has already acknowledged or rejected this batch.
      try {
        await clearOfflineQueue(ownerId);
      } catch {
        // The in-memory queue is still cleared below; there is no plaintext
        // fallback when browser storage is unavailable.
      }
      setOffline([]);
      setTransactionState("attention");
      setError(t("offlineSyncFailed"));
      return false;
    }
  };

  const scanNow = async (allowRepeat = false) => {
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
      setTransactionState("confirmed");
      toast.success(scan.firstTime ? t("scanRegistered") : t("repeatRegistered"));
      setBadgeId("");
      setRepeatPrompt(null);
      activities.refetch();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === "repeat_confirmation_required" &&
        err.details &&
        typeof err.details === "object"
      ) {
        setRepeatPrompt(err.details as ActivityScanResult);
      } else {
        setTransactionState("attention");
        setError(errorMessage(err, t("scanFailed")));
      }
    } finally {
      setBusy(false);
    }
  };

  const queueOffline = async () => {
    if (!selected || ownerId === null || ownerRef.current !== ownerId || !queueReady) return;
    try {
      await persistOffline([
        ...offline,
        {
          clientScanId: crypto.randomUUID(),
          activityId: selected.activityId,
          activityName: selected.name,
          badgeId: badgeId.trim(),
          allowRepeat: false,
          scannedAt: new Date().toISOString(),
          status: "pending",
        },
      ]);
      setBadgeId("");
      setTransactionState("saved");
      toast.success(t("scanQueuedLocally"));
    } catch {
      setTransactionState("attention");
      setError(t("offlineSyncFailed"));
    }
  };

  const syncOffline = async () => {
    if (ownerId === null || ownerRef.current !== ownerId || !queueReady) return;
    const queued = offline.filter((scan) => scan.status !== "syncing");
    if (queued.length === 0) return;
    setBusy(true);
    let next = [...offline];
    // Replay in capture order. A transient failure stops the queue; a server
    // business rejection is inspectable and does not block later operations.
    for (const scan of queued) {
      if (ownerRef.current !== ownerId) break;
      next = next.map((item) =>
        item.clientScanId === scan.clientScanId
          ? { ...item, status: "syncing", error: undefined, failureKind: undefined }
          : item,
      );
      setOffline(next);
      try {
        await logisticsApi.mealBatch(scan.activityId, {
          deviceId: "web-scanner",
          scans: [
            {
              clientScanId: scan.clientScanId,
              badgeId: scan.badgeId,
              allowRepeat: scan.allowRepeat,
              scannedAt: scan.scannedAt,
            },
          ],
        });
        if (ownerRef.current !== ownerId) break;
        next = next.filter((item) => item.clientScanId !== scan.clientScanId);
        if (!(await persistSyncedQueue(next))) break;
        setTransactionState("confirmed");
      } catch (err) {
        // A participant may have been deleted/anonymized while this browser
        // was offline. Keeping the raw badge in a permanent "failed" row
        // would retain a credential the server has deliberately revoked.
        const staleIdentityRejection = isStaleOfflineScanError(err);
        if (staleIdentityRejection) {
          next = next.filter((item) => item.clientScanId !== scan.clientScanId);
          if (!(await persistSyncedQueue(next))) break;
          setTransactionState("attention");
          continue;
        }
        const message = errorMessage(err, t("offlineSyncFailed"));
        const businessRejection =
          err instanceof ApiError &&
          err.status >= 400 &&
          err.status < 500 &&
          ![401, 403, 408, 429].includes(err.status);
        next = next.map((item) =>
          item.clientScanId === scan.clientScanId
            ? {
                ...item,
                status: businessRejection ? "failed" : "pending",
                error: message,
                failureKind: businessRejection ? "rejected" : "offline",
              }
            : item,
        );
        if (!(await persistSyncedQueue(next))) break;
        setTransactionState(businessRejection ? "attention" : "saved");
        if (!businessRejection) break;
      }
    }
    setBusy(false);
    activities.refetch();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={isMeal ? t("servingsLabel") : t("columnScans")}
          value={selected ? selected.count : "—"}
          icon={isMeal ? SoupIcon : ActivityIcon}
          hint={selected ? selected.name : t("selectToSeeCounts")}
        />
        <StatCard
          label={t("columnPeople")}
          value={selected ? selected.distinctPeople : "—"}
          icon={UsersIcon}
          hint={t("distinctAttendees")}
        />
        <StatCard
          label={t("columnRepeats")}
          value={selected ? selected.repeats : "—"}
          icon={RepeatIcon}
          hint={activities.connected ? t("live") : t("reconnectsAutomatically")}
        />
      </div>

      <SectionCard
        title={isMeal ? t("mealLineTitle") : t("activityDoorTitle")}
        description={isMeal ? t("scanEachBadgeDesc") : t("scanBadgesEntranceDesc")}
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
            title={isMeal ? t("noMealsDefinedTitle") : t("noRegistrableActivitiesTitle")}
            description={
              isMeal ? t("mealsCreatedInScheduleDesc") : t("markActivitiesRequiresScanDesc")
            }
          />
        ) : (
          <>
            <div
              aria-live={transactionState === "attention" ? "assertive" : "polite"}
              className="bg-muted/40 flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2"
              role="status"
            >
              {transactionState === "confirmed" ? (
                <CheckCircleIcon aria-hidden className="text-success size-5 shrink-0" />
              ) : transactionState === "attention" ? (
                <TriangleAlertIcon aria-hidden className="text-destructive size-5 shrink-0" />
              ) : transactionState === "saved" ? (
                <HardDriveIcon aria-hidden className="text-warning size-5 shrink-0" />
              ) : (
                <ScanLineIcon aria-hidden className="text-primary size-5 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t(
                    transactionState === "ready"
                      ? "scannerStateReady"
                      : transactionState === "saved"
                        ? "scannerStateSaved"
                        : transactionState === "confirmed"
                          ? "confirmed"
                          : "scannerStateAttention",
                  )}
                </p>
                <p className="text-muted-foreground text-pretty text-xs">
                  {t(
                    transactionState === "ready"
                      ? "scannerReadyDescription"
                      : transactionState === "saved"
                        ? "scannerAwaitingAcknowledgement"
                        : transactionState === "confirmed"
                          ? "scannerConfirmedDescription"
                          : "scannerAttentionDescription",
                  )}
                </p>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)_140px]">
              <Field id="activity-scan-activity" label={t("columnActivity")}>
                <EntityCombobox
                  id="activity-scan-activity"
                  options={items}
                  value={activityId}
                  onChange={setActivityId}
                  getId={(activity) => activity.activityId}
                  getLabel={(activity) => activity.name}
                  placeholder={isMeal ? t("chooseMeal") : t("chooseActivityOption")}
                />
              </Field>
              <Field id="activity-scan-badge" label={t("badge")}>
                <div className="flex gap-2">
                  <Input
                    id="activity-scan-badge"
                    value={badgeId}
                    onChange={(e) => setBadgeId(e.target.value)}
                    placeholder={t("badgePlaceholder")}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("personSearchTitle")}
                    onClick={() => setFindOpen(true)}
                  >
                    <UsersIcon className="size-4" />
                  </Button>
                </div>
              </Field>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={() => void scanNow()}
                  disabled={busy || !activityId || !badgeId.trim()}
                >
                  <ScanLineIcon className="size-4" />
                  {t("scan")}
                </Button>
              </div>
            </div>

            {error && <InlineError message={error} />}
            {result && <ScanResult result={result} />}
            <Modal
              open={repeatPrompt !== null}
              onOpenChange={(open) => {
                if (!open) setRepeatPrompt(null);
              }}
              icon={RepeatIcon}
              title={t("repeatConfirmationTitle")}
              description={
                repeatPrompt
                  ? t("repeatConfirmationDesc", { count: repeatPrompt.timesEaten })
                  : undefined
              }
              footer={
                <>
                  <Button variant="outline" onClick={() => setRepeatPrompt(null)} disabled={busy}>
                    {t("cancel")}
                  </Button>
                  <Button onClick={() => void scanNow(true)} disabled={busy}>
                    {t("allowRepeat")}
                  </Button>
                </>
              }
            >
              {repeatPrompt && <ScanResult result={repeatPrompt} />}
            </Modal>

            <Modal
              open={findOpen}
              onOpenChange={(open) => {
                setFindOpen(open);
                if (!open) {
                  setFindQuery("");
                  setFindResults(null);
                  setFindError("");
                }
              }}
              icon={SearchIcon}
              title={t("personSearchTitle")}
              description={t("personSearchDesc")}
            >
              <div className="space-y-4">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void doFind();
                  }}
                >
                  <Label htmlFor="person-search-find" className="sr-only">
                    {t("personSearchTitle")}
                  </Label>
                  <Input
                    id="person-search-find"
                    value={findQuery}
                    onChange={(e) => setFindQuery(e.target.value)}
                    placeholder={t("personSearchPlaceholder")}
                    autoComplete="off"
                    autoFocus
                  />
                  <Button type="submit" disabled={findBusy || !findQuery.trim()}>
                    {findBusy ? <Spinner /> : <SearchIcon className="size-4" />}
                    {t("search")}
                  </Button>
                </form>

                {findError && <InlineError message={findError} />}

                {findResults && (
                  <div className="max-h-80 overflow-y-auto">
                    <PersonSearchResults results={findResults} onSelect={pickFound} />
                  </div>
                )}
              </div>
            </Modal>

            {isMeal && (
              <>
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={queueOffline}
                    disabled={!queueReady || !activityId || !badgeId.trim()}
                  >
                    {t("queueLocally")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={syncOffline}
                    disabled={busy || offline.length === 0}
                  >
                    {t("syncPending", { count: offline.length })}
                  </Button>
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
