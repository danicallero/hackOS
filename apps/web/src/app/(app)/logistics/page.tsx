"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  ActivityIcon,
  BadgeCheckIcon,
  CalendarDaysIcon,
  CheckIcon,
  DoorOpenIcon,
  DownloadIcon,
  IdCardIcon,
  LockIcon,
  RotateCcwIcon,
  ScanLineIcon,
  SoupIcon,
  UsersIcon,
  WalletCardsIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useLiveQuery } from "@/hooks/use-event-source";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import {
  type AccreditationLookup,
  type ActivityScanResult,
  type LogisticsStats,
  logisticsApi,
  type PersonCard,
  type PresenceHours,
  type PublicScheduleItem,
  personName,
} from "@/lib/logistics";
import { useSessionContext } from "@/lib/session";
import type { UserList, UserListItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type OfflineScan = {
  clientScanId: string;
  activityId: number;
  activityName: string;
  badgeId: string;
  allowRepeat: boolean;
  scannedAt: string;
  status: "pending" | "syncing" | "failed";
  error?: string;
};

const OFFLINE_KEY = "hackos:logistics:meal-scans";
const LOGISTICS_EVENTS = [
  EVENTS.LOGISTICS_ACCREDITED,
  EVENTS.LOGISTICS_BADGE_ROTATED,
  EVENTS.LOGISTICS_PRESENCE_SCAN,
  EVENTS.LOGISTICS_ACTIVITY_SCAN,
  EVENTS.LOGISTICS_MEAL_SCAN_BATCH,
  EVENTS.LOGISTICS_WALLET_PASS_UPDATED,
];

function loadOfflineQueue(): OfflineScan[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(OFFLINE_KEY) ?? "[]") as OfflineScan[];
  } catch {
    return [];
  }
}

function saveOfflineQueue(items: OfflineScan[]) {
  window.localStorage.setItem(OFFLINE_KEY, JSON.stringify(items));
}

function labelForIntolerance(item: { label: unknown }): string {
  if (typeof item.label === "string") return item.label;
  if (item.label && typeof item.label === "object") {
    const label = item.label as Record<string, unknown>;
    return String(label.es ?? label.en ?? label.gl ?? "Intolerance");
  }
  return "Intolerance";
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function LogisticsPage() {
  const { can, canAny } = useSessionContext();
  const canAccredit = can(CAPABILITIES.ACCREDIT_SCAN);
  const canPresence = can(CAPABILITIES.PRESENCE_SCAN);
  const canScan = can(CAPABILITIES.ACTIVITY_SCAN);
  const canStats = can(CAPABILITIES.LOGISTICS_STATS);
  const canSchedule = can(CAPABILITIES.SCHEDULE_MANAGE);
  const canUse = canAny(
    CAPABILITIES.ACCREDIT_SCAN,
    CAPABILITIES.PRESENCE_SCAN,
    CAPABILITIES.ACTIVITY_SCAN,
    CAPABILITIES.LOGISTICS_STATS,
    CAPABILITIES.SCHEDULE_MANAGE,
  );

  const stats = useLiveQuery<LogisticsStats>(
    logisticsApi.stats,
    "/api/logistics/stream",
    LOGISTICS_EVENTS,
    { enabled: canStats },
  );
  const hours = useLiveQuery<PresenceHours[]>(
    logisticsApi.presenceHours,
    "/api/logistics/stream",
    [EVENTS.LOGISTICS_PRESENCE_SCAN, EVENTS.LOGISTICS_ACTIVITY_SCAN],
    { enabled: canStats },
  );
  const schedule = useLiveQuery<{ items: PublicScheduleItem[] }>(
    logisticsApi.publicSchedule,
    "/api/logistics/stream",
    [EVENTS.LOGISTICS_ACTIVITY_SCAN],
    { enabled: canUse, debounceMs: 500 },
  );

  if (!canUse) {
    return (
      <div className="space-y-6">
        <PageHeader title="Logistics" />
        <EmptyState
          icon={LockIcon}
          title="You can't access logistics"
          description="Accreditation, presence, activity scanning or logistics stats capability is required."
        />
      </div>
    );
  }

  const s = stats.data;
  const defaultTab = canAccredit
    ? "accreditation"
    : canScan
      ? "scanner"
      : canPresence
        ? "presence"
        : "stats";

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title="Logistics"
        description="Accreditation, presence, meal service, registrable activities and Wallet passes."
        actions={
          <Button variant="outline" asChild>
            <Link href="/wallet">
              <WalletCardsIcon className="size-4" />
              My wallet
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Accredited"
          value={s?.accreditedCount ?? "—"}
          icon={BadgeCheckIcon}
          hint="Current badge assignments"
        />
        <StatCard
          label="Present now"
          value={s?.currentlyPresent ?? "—"}
          icon={UsersIcon}
          hint="Estimated from scans"
        />
        <StatCard
          label="Meals served"
          value={s ? s.meals.reduce((sum, meal) => sum + meal.served, 0) : "—"}
          icon={SoupIcon}
          hint="Includes repeat servings"
        />
        <StatCard
          label="Activity scans"
          value={s ? s.activities.reduce((sum, activity) => sum + activity.scans, 0) : "—"}
          icon={ActivityIcon}
          hint={stats.connected ? "Live" : "Reconnects automatically"}
        />
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {canAccredit && <TabsTrigger value="accreditation">Accreditation</TabsTrigger>}
          {canScan && <TabsTrigger value="scanner">Meals & activities</TabsTrigger>}
          {canPresence && <TabsTrigger value="presence">Presence</TabsTrigger>}
          {(canStats || canSchedule) && <TabsTrigger value="stats">Panels</TabsTrigger>}
          <TabsTrigger value="wallet">Wallet</TabsTrigger>
        </TabsList>

        {canAccredit && (
          <TabsContent value="accreditation" className="space-y-6 pt-2">
            <AccreditationPanel />
          </TabsContent>
        )}

        {canScan && (
          <TabsContent value="scanner" className="space-y-6 pt-2">
            <ActivityScanner stats={s} loading={stats.loading} onChanged={stats.refetch} />
            <EntitlementPanel stats={s} canManage={canSchedule} onChanged={stats.refetch} />
          </TabsContent>
        )}

        {canPresence && (
          <TabsContent value="presence" className="space-y-6 pt-2">
            <PresencePanel hours={hours.data ?? []} loading={hours.loading} />
          </TabsContent>
        )}

        {(canStats || canSchedule) && (
          <TabsContent value="stats" className="space-y-6 pt-2">
            <StatsPanel stats={s} loading={stats.loading} />
            <SchedulePanel items={schedule.data?.items ?? []} loading={schedule.loading} />
          </TabsContent>
        )}

        <TabsContent value="wallet" className="space-y-6 pt-2">
          <WalletPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccreditationPanel() {
  const searchParams = useSearchParams();
  const [ticketToken, setTicketToken] = useState("");
  const [badgeId, setBadgeId] = useState("");
  const [method, setMethod] = useState<"qr" | "manual" | "nfc">("qr");
  const [lookup, setLookup] = useState<AccreditationLookup | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotate, setRotate] = useState({
    userId: "",
    currentBadgeId: "",
    newBadgeId: "",
    reason: "",
  });

  const doLookup = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.lookup(ticketToken.trim());
      setLookup(result);
      setSelectedUserId(result.userId);
      if (result.currentBadge && !badgeId) setBadgeId(result.currentBadge);
    } catch (err) {
      setLookup(null);
      setError(errorMessage(err, "Ticket lookup failed."));
    } finally {
      setBusy(false);
    }
  };

  const searchUsers = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.get<UserList>("/api/users", {
        query: { q: userQuery.trim() || undefined, limit: 8 },
      });
      setUserResults(result.users);
    } catch (err) {
      setUserResults([]);
      setError(errorMessage(err, "User search failed."));
    } finally {
      setBusy(false);
    }
  };

  const lookupUser = useCallback(
    async (userId: number) => {
      setBusy(true);
      setError("");
      try {
        const result = await logisticsApi.lookupUser(userId);
        setLookup(result);
        setSelectedUserId(result.userId);
        if (result.currentBadge && !badgeId) setBadgeId(result.currentBadge);
      } catch (err) {
        setLookup(null);
        setError(errorMessage(err, "User lookup failed."));
      } finally {
        setBusy(false);
      }
    },
    [badgeId],
  );

  useEffect(() => {
    const raw = searchParams.get("userId");
    if (!raw) return;
    const id = Number(raw);
    if (Number.isFinite(id)) void lookupUser(id);
  }, [searchParams, lookupUser]);

  const doCheckIn = async () => {
    setBusy(true);
    setError("");
    try {
      const result =
        selectedUserId != null
          ? await logisticsApi.checkInUser({
              userId: selectedUserId,
              badgeId: badgeId.trim(),
              method,
            })
          : await logisticsApi.checkIn({
              ticketToken: ticketToken.trim(),
              badgeId: badgeId.trim(),
              method,
            });
      toast.success(`Badge ${result.badgeId} assigned to ${personName(result)}.`);
      setLookup({
        ...(lookup as AccreditationLookup),
        alreadyAccredited: true,
        currentBadge: result.badgeId,
      });
    } catch (err) {
      setError(errorMessage(err, "Check-in failed."));
    } finally {
      setBusy(false);
    }
  };

  const doRotate = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.rotate({
        userId: rotate.userId ? Number(rotate.userId) : undefined,
        currentBadgeId: rotate.currentBadgeId.trim() || undefined,
        newBadgeId: rotate.newBadgeId.trim(),
        reason: rotate.reason.trim(),
      });
      toast.success(`Badge rotated to ${result.newBadge}.`);
      setRotate({ userId: "", currentBadgeId: "", newBadgeId: "", reason: "" });
    } catch (err) {
      setError(errorMessage(err, "Badge rotation failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      <SectionCard
        title="Ticket check-in"
        description="Scan an entrance QR, confirm the person card, then assign the physical badge."
        icon={IdCardIcon}
        bodyClassName="space-y-4"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
          <div className="space-y-2">
            <Label htmlFor="ticket-token">Ticket token</Label>
            <Input
              id="ticket-token"
              value={ticketToken}
              onChange={(e) => setTicketToken(e.target.value)}
              placeholder="ticket QR payload"
              autoComplete="off"
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={doLookup} disabled={busy || !ticketToken.trim()}>
              {busy ? <Spinner /> : <ScanLineIcon className="size-4" />}
              Lookup
            </Button>
          </div>
        </div>

        <div className="grid gap-3 border-t pt-4 md:grid-cols-[minmax(0,1fr)_160px]">
          <div className="space-y-2">
            <Label htmlFor="user-search">Find user</Label>
            <Input
              id="user-search"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="name, surname or email"
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" variant="outline" onClick={searchUsers} disabled={busy}>
              Search
            </Button>
          </div>
        </div>

        {userResults.length > 0 && (
          <div className="rounded-lg border">
            {userResults.map((user) => (
              <button
                key={user.id}
                type="button"
                className="hover:bg-muted flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0"
                onClick={() => void lookupUser(user.id)}
              >
                <span>
                  <span className="block text-sm font-medium">
                    {[user.name, user.surname].filter(Boolean).join(" ") || user.email}
                  </span>
                  <span className="text-muted-foreground block text-xs">{user.email}</span>
                </span>
                <StatusBadge tone={user.confirmedSpot ? "success" : "neutral"} dot={false}>
                  {user.confirmedSpot ? "confirmed" : (user.applicationStatus ?? "no app")}
                </StatusBadge>
              </button>
            ))}
          </div>
        )}

        {error && <InlineError message={error} />}
        {lookup && <PersonCardView card={lookup} />}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px]">
          <div className="space-y-2">
            <Label htmlFor="badge-id">Badge ID</Label>
            <Input
              id="badge-id"
              value={badgeId}
              onChange={(e) => setBadgeId(e.target.value)}
              placeholder="B-1024"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="qr">QR</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="nfc">NFC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={doCheckIn}
              disabled={busy || !lookup || !badgeId.trim()}
            >
              <CheckIcon className="size-4" />
              Check in
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Lost badge"
        description="Rotate a badge and void active badge wallet passes."
        icon={RotateCcwIcon}
        bodyClassName="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="User ID">
            <Input
              value={rotate.userId}
              onChange={(e) => setRotate((r) => ({ ...r, userId: e.target.value }))}
              inputMode="numeric"
              placeholder="42"
            />
          </Field>
          <Field label="Current badge">
            <Input
              value={rotate.currentBadgeId}
              onChange={(e) => setRotate((r) => ({ ...r, currentBadgeId: e.target.value }))}
              placeholder="or scan old badge"
            />
          </Field>
        </div>
        <Field label="New badge">
          <Input
            value={rotate.newBadgeId}
            onChange={(e) => setRotate((r) => ({ ...r, newBadgeId: e.target.value }))}
            placeholder="B-2048"
          />
        </Field>
        <Field label="Reason">
          <Textarea
            value={rotate.reason}
            onChange={(e) => setRotate((r) => ({ ...r, reason: e.target.value }))}
            placeholder="lost, damaged, unreadable..."
          />
        </Field>
        <Button
          onClick={doRotate}
          disabled={
            busy ||
            !rotate.newBadgeId.trim() ||
            !rotate.reason.trim() ||
            (!rotate.userId.trim() && !rotate.currentBadgeId.trim())
          }
        >
          <RotateCcwIcon className="size-4" />
          Rotate badge
        </Button>
      </SectionCard>
    </div>
  );
}

function ActivityScanner({
  stats,
  loading,
  onChanged,
}: {
  stats: LogisticsStats | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const activities = useMemo(
    () => [
      ...(stats?.meals.map((meal) => ({
        id: meal.activityId,
        name: meal.name,
        category: "meal",
      })) ?? []),
      ...(stats?.activities.map((activity) => ({
        id: activity.activityId,
        name: activity.name,
        category: activity.category,
      })) ?? []),
    ],
    [stats],
  );
  const [activityId, setActivityId] = useState("");
  const [badgeId, setBadgeId] = useState("");
  const [allowRepeat, setAllowRepeat] = useState(false);
  const [result, setResult] = useState<ActivityScanResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState<OfflineScan[]>([]);
  const selected = activities.find((a) => String(a.id) === activityId) ?? null;

  useEffect(() => {
    setOffline(loadOfflineQueue());
  }, []);

  const persistOffline = (items: OfflineScan[]) => {
    setOffline(items);
    saveOfflineQueue(items);
  };

  const scanNow = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const scan = await logisticsApi.activityScan(selected.id, {
        badgeId: badgeId.trim(),
        allowRepeat,
      });
      setResult(scan);
      toast.success(scan.firstTime ? "Scan registered." : "Repeat registered.");
      setBadgeId("");
      setAllowRepeat(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Scan failed."));
    } finally {
      setBusy(false);
    }
  };

  const queueOffline = () => {
    if (selected?.category !== "meal") {
      setError("Only meals can be queued as offline batches.");
      return;
    }
    const next = [
      ...offline,
      {
        clientScanId: crypto.randomUUID(),
        activityId: selected.id,
        activityName: selected.name,
        badgeId: badgeId.trim(),
        allowRepeat,
        scannedAt: new Date().toISOString(),
        status: "pending" as const,
      },
    ];
    persistOffline(next);
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
    onChanged();
  };

  return (
    <SectionCard
      title="Scanner"
      description="Register meal servings and registrable activity attendance."
      icon={ScanLineIcon}
      bodyClassName="space-y-5"
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-5" />
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No scannable activities yet"
          description="Meals and activities appear here once they exist in logistics stats."
        />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)_140px_140px]">
            <Field label="Activity">
              <Select value={activityId} onValueChange={setActivityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose activity" />
                </SelectTrigger>
                <SelectContent>
                  {activities.map((activity) => (
                    <SelectItem
                      key={`${activity.category}-${activity.id}`}
                      value={String(activity.id)}
                    >
                      {activity.name} · {activity.category === "meal" ? "meal" : "activity"}
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
            <div className="flex items-end gap-2">
              <Button
                className="flex-1"
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

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button
              variant="outline"
              onClick={queueOffline}
              disabled={selected?.category !== "meal" || !badgeId.trim()}
            >
              Queue locally
            </Button>
            <Button variant="outline" onClick={syncOffline} disabled={busy || offline.length === 0}>
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
    </SectionCard>
  );
}

function PresencePanel({ hours, loading }: { hours: PresenceHours[]; loading: boolean }) {
  const [badgeId, setBadgeId] = useState("");
  const [kind, setKind] = useState<"in" | "out">("in");
  const [location, setLocation] = useState("");
  const [scannedAt, setScannedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const scan = async () => {
    setBusy(true);
    setError("");
    try {
      await logisticsApi.presenceScan({
        badgeId: badgeId.trim(),
        kind,
        location: location.trim() || undefined,
        scannedAt: scannedAt ? new Date(scannedAt).toISOString() : undefined,
      });
      toast.success(kind === "in" ? "Entry recorded." : "Exit recorded.");
      setBadgeId("");
      setScannedAt("");
    } catch (err) {
      setError(errorMessage(err, "Presence scan failed."));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<PresenceHours>[] = [
    {
      id: "user",
      header: "User",
      sortValue: (row) => row.userId,
      cell: (row) => <span className="font-mono text-sm">#{row.userId}</span>,
    },
    {
      id: "hours",
      header: "Hours",
      align: "right",
      sortValue: (row) => row.hours,
      cell: (row) => <span className="font-mono tabular-nums">{row.hours.toFixed(2)}</span>,
    },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
      <SectionCard
        title="Door scan"
        description="Register entry, exit, or backdated manual passes."
        icon={DoorOpenIcon}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Badge">
            <Input
              value={badgeId}
              onChange={(e) => setBadgeId(e.target.value)}
              placeholder="scan badge"
            />
          </Field>
          <Field label="Direction">
            <Select value={kind} onValueChange={(v) => setKind(v as "in" | "out")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Entry</SelectItem>
                <SelectItem value="out">Exit</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Location">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="main door"
          />
        </Field>
        <Field label="Manual timestamp">
          <Input
            type="datetime-local"
            value={scannedAt}
            onChange={(e) => setScannedAt(e.target.value)}
          />
        </Field>
        {error && <InlineError message={error} />}
        <Button onClick={scan} disabled={busy || !badgeId.trim()}>
          <DoorOpenIcon className="size-4" />
          Record {kind === "in" ? "entry" : "exit"}
        </Button>
      </SectionCard>

      <SectionCard
        title="Attendance hours"
        description="Estimated from door, meal and activity signals."
        icon={UsersIcon}
      >
        <DataTable
          columns={columns}
          data={hours}
          getRowId={(row) => String(row.userId)}
          loading={loading}
          searchable={(row) => `${row.userId} ${row.hours}`}
          searchPlaceholder="Filter users..."
          pageSize={10}
          empty={{
            icon: UsersIcon,
            title: "No presence yet",
            description: "Door, meal or activity scans will appear here.",
          }}
        />
      </SectionCard>
    </div>
  );
}

function EntitlementPanel({
  stats,
  canManage,
  onChanged,
}: {
  stats: LogisticsStats | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const meals = stats?.meals ?? [];
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = [...selectedIds].map(Number);
  const grantSelected = async () => {
    if (!userId.trim()) return;
    setBusy(true);
    try {
      await Promise.all(selected.map((id) => logisticsApi.grantEntitlement(id, Number(userId))));
      toast.success(
        `Granted ${selected.length} meal entitlement${selected.length === 1 ? "" : "s"}.`,
      );
      setUserId("");
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Could not grant entitlements."));
    } finally {
      setBusy(false);
    }
  };

  const bulkConfirmed = async () => {
    setBusy(true);
    try {
      const results = await Promise.all(selected.map((id) => logisticsApi.bulkGrantConfirmed(id)));
      const total = results.reduce((sum, result) => sum + result.granted, 0);
      toast.success(`Granted ${total} confirmed-participant meal entitlements.`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Could not bulk grant entitlements."));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<LogisticsStats["meals"][number]>[] = [
    {
      id: "name",
      header: "Meal",
      sortValue: (m) => m.name,
      cell: (m) => <span className="font-medium">{m.name}</span>,
    },
    {
      id: "served",
      header: "Served",
      align: "right",
      sortValue: (m) => m.served,
      cell: (m) => m.served,
    },
    {
      id: "distinct",
      header: "People",
      align: "right",
      sortValue: (m) => m.distinctPeople,
      cell: (m) => m.distinctPeople,
    },
    {
      id: "repeats",
      header: "Repeats",
      align: "right",
      sortValue: (m) => m.repeats,
      cell: (m) => m.repeats,
    },
  ];

  if (!canManage) return null;

  return (
    <SectionCard
      title="Meal entitlements"
      description="Select meals, then grant one person or all confirmed participants."
      icon={SoupIcon}
    >
      <DataTable
        columns={columns}
        data={meals}
        getRowId={(meal) => String(meal.activityId)}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        searchable={(meal) => meal.name}
        empty={{ icon: SoupIcon, title: "No meals yet" }}
        toolbar={
          selectedIds.size > 0 ? (
            <>
              <span className="text-muted-foreground text-sm">{selectedIds.size} selected</span>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="User ID"
                inputMode="numeric"
                className="h-9 w-28"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !userId.trim()}
                onClick={grantSelected}
              >
                Grant user
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={bulkConfirmed}>
                Grant confirmed
              </Button>
            </>
          ) : undefined
        }
      />
    </SectionCard>
  );
}

function StatsPanel({ stats, loading }: { stats: LogisticsStats | null; loading: boolean }) {
  const mealColumns: Column<LogisticsStats["meals"][number]>[] = [
    {
      id: "name",
      header: "Meal",
      sortValue: (m) => m.name,
      cell: (m) => <span className="font-medium">{m.name}</span>,
    },
    {
      id: "served",
      header: "Served",
      align: "right",
      sortValue: (m) => m.served,
      cell: (m) => m.served,
    },
    {
      id: "people",
      header: "People",
      align: "right",
      sortValue: (m) => m.distinctPeople,
      cell: (m) => m.distinctPeople,
    },
    {
      id: "repeat",
      header: "Repeats",
      align: "right",
      sortValue: (m) => m.repeats,
      cell: (m) => m.repeats,
    },
  ];
  const activityColumns: Column<LogisticsStats["activities"][number]>[] = [
    {
      id: "name",
      header: "Activity",
      sortValue: (a) => a.name,
      cell: (a) => <span className="font-medium">{a.name}</span>,
    },
    {
      id: "category",
      header: "Category",
      sortValue: (a) => a.category,
      cell: (a) => <StatusBadge tone="neutral">{a.category}</StatusBadge>,
    },
    {
      id: "scans",
      header: "Scans",
      align: "right",
      sortValue: (a) => a.scans,
      cell: (a) => a.scans,
    },
    {
      id: "attendees",
      header: "People",
      align: "right",
      sortValue: (a) => a.attendees,
      cell: (a) => a.attendees,
    },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title="Meals" icon={SoupIcon}>
        <DataTable
          columns={mealColumns}
          data={stats?.meals ?? []}
          getRowId={(row) => String(row.activityId)}
          loading={loading}
          empty={{ icon: SoupIcon, title: "No meal scans yet" }}
        />
      </SectionCard>
      <SectionCard title="Registrable activities" icon={ActivityIcon}>
        <DataTable
          columns={activityColumns}
          data={stats?.activities ?? []}
          getRowId={(row) => String(row.activityId)}
          loading={loading}
          empty={{ icon: ActivityIcon, title: "No activity scans yet" }}
        />
      </SectionCard>
    </div>
  );
}

function SchedulePanel({ items, loading }: { items: PublicScheduleItem[]; loading: boolean }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const columns: Column<PublicScheduleItem>[] = [
    {
      id: "title",
      header: "Calendar item",
      sortValue: (i) => i.title,
      cell: (i) => <span className="font-medium">{i.title}</span>,
    },
    {
      id: "type",
      header: "Type",
      sortValue: (i) => i.type ?? "",
      cell: (i) => <StatusBadge tone="neutral">{i.type ?? "activity"}</StatusBadge>,
    },
    {
      id: "starts",
      header: "Starts",
      sortValue: (i) => i.startsAt,
      cell: (i) => new Date(i.startsAt).toLocaleString(),
    },
    {
      id: "location",
      header: "Location",
      sortValue: (i) => i.location ?? "",
      cell: (i) => i.location ?? <span className="text-muted-foreground">-</span>,
    },
  ];
  return (
    <SectionCard
      title="Published calendar"
      description="Selectable schedule view for the event floor. Visibility batch actions belong to schedule management."
      icon={CalendarDaysIcon}
    >
      <DataTable
        columns={columns}
        data={items}
        getRowId={(item) => String(item.id)}
        loading={loading}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        searchable={(item) => `${item.title} ${item.type ?? ""} ${item.location ?? ""}`}
        toolbar={
          selectedIds.size > 0 ? (
            <span className="text-muted-foreground text-sm">{selectedIds.size} selected</span>
          ) : undefined
        }
        empty={{ icon: CalendarDaysIcon, title: "No published calendar items" }}
      />
    </SectionCard>
  );
}

function WalletPanel() {
  return (
    <SectionCard
      title="Mobile passes"
      description="Download Apple Wallet passes for the current account. Badge passes require an assigned badge."
      icon={WalletCardsIcon}
      bodyClassName="grid gap-3 sm:grid-cols-2"
    >
      <WalletDownload
        purpose="ticket"
        title="Ticket"
        description="Entrance QR. It is permanent once issued."
      />
      <WalletDownload
        purpose="badge"
        title="Badge"
        description="Physical badge QR. Rotation voids old passes."
      />
    </SectionCard>
  );
}

function WalletDownload({
  purpose,
  title,
  description,
}: {
  purpose: "ticket" | "badge";
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">{description}</p>
        </div>
        <StatusBadge tone={purpose === "ticket" ? "success" : "info"}>{purpose}</StatusBadge>
      </div>
      <Button
        className="mt-4 w-full"
        variant="outline"
        onClick={() => window.open(`${API_URL}/api/me/wallet/apple/${purpose}.pkpass`, "_blank")}
      >
        <DownloadIcon className="size-4" />
        Download .pkpass
      </Button>
    </div>
  );
}

function PersonCardView({ card }: { card: AccreditationLookup | PersonCard }) {
  const intolerances = card.intolerances.map(labelForIntolerance);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{personName(card)}</p>
          <p className="text-muted-foreground text-sm">User #{card.userId}</p>
        </div>
        {"confirmed" in card && (
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={card.confirmed ? "success" : "warning"}>
              {card.confirmed ? "Confirmed" : "Not confirmed"}
            </StatusBadge>
            <StatusBadge tone={card.alreadyAccredited ? "info" : "neutral"}>
              {card.alreadyAccredited ? `Badge ${card.currentBadge}` : "No badge"}
            </StatusBadge>
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-xs">Food</p>
          <p className="text-sm">
            {intolerances.length ? intolerances.join(", ") : "No restrictions"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Notes</p>
          <p className="text-sm">{card.foodIntoleranceNotes || card.notes || "No notes"}</p>
        </div>
      </div>
    </div>
  );
}

function ScanResult({ result }: { result: ActivityScanResult }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        result.repeat ? "border-warning/50 bg-warning/10" : "border-success/40 bg-success/10",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{personName(result.card)}</p>
          <p className="text-muted-foreground text-sm">
            {result.firstTime ? "First scan" : `Repeat scan · ${result.timesEaten} total`}
          </p>
        </div>
        <StatusBadge tone={result.repeat ? "warning" : "success"}>
          {result.repeat ? "Repeat" : "Registered"}
        </StatusBadge>
      </div>
      <div className="mt-3">
        <PersonCardView card={result.card} />
      </div>
    </div>
  );
}

function OfflineQueue({ items }: { items: OfflineScan[] }) {
  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-2">
        <p className="text-sm font-medium">Local queue</p>
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
            <StatusBadge
              tone={
                item.status === "failed" ? "danger" : item.status === "syncing" ? "info" : "neutral"
              }
            >
              {item.status}
            </StatusBadge>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
      <XIcon className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
