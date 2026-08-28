"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  DoorOpenIcon,
  LogInIcon,
  LogOutIcon,
  ScanLineIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { TabBar } from "@/components/common/tab-bar";
import { PersonCardView } from "@/components/logistics/person-card";
import { errorMessage, Field, InlineError } from "@/components/logistics/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { useLiveQuery } from "@/hooks/use-event-source";
import { LOCALE_CODES, type Translate, useLocale } from "@/lib/i18n";
import {
  logisticsApi,
  type OpenPresenceSession,
  type PresenceEstimate,
  type PresenceHours,
  type PresenceLookup,
  personName,
} from "@/lib/logistics";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";

const PRESENCE_TABS = ["scan", "sessions", "hours"] as const;
type PresenceTab = (typeof PRESENCE_TABS)[number];

const TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

function hoursSince(iso: string, t: Translate): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? t("presenceLessThanHourAgo") : t("presenceHoursAgo", { hours: Math.round(h) });
}

function queryLoadError(
  error: unknown,
  fallback: string,
  onRetry: () => void,
): { message: string; onRetry: () => void } | undefined {
  return error ? { message: errorMessage(error, fallback), onRetry } : undefined;
}

const PRESENCE_EVENTS = [EVENTS.LOGISTICS_PRESENCE_SCAN, EVENTS.LOGISTICS_ACTIVITY_SCAN];

export default function PresencePage() {
  const { t } = useLocale();
  const canPresence = useCan(CAPABILITIES.PRESENCE_SCAN);
  const { tab, setTab } = useUrlTab<PresenceTab>({
    values: PRESENCE_TABS,
    defaultValue: "scan",
  });

  const estimate = useLiveQuery<PresenceEstimate>(
    logisticsApi.presenceEstimate,
    "/api/logistics/stream",
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400 },
  );
  const hours = useLiveQuery<PresenceHours[]>(
    logisticsApi.presenceHours,
    "/api/logistics/stream",
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400 },
  );
  const openSessions = useLiveQuery<OpenPresenceSession[]>(
    async () => (await logisticsApi.presenceOpenSessions()).items,
    "/api/logistics/stream",
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400 },
  );

  // H24/H27: each read model keeps its own failure and retry path so one
  // outage cannot make another operational dataset look empty or unknown.
  const estimateError = queryLoadError(
    estimate.error,
    t("attendanceDataUnavailable"),
    estimate.refetch,
  );
  const hoursError = queryLoadError(hours.error, t("couldNotLoadStatistics"), hours.refetch);
  const openSessionsError = queryLoadError(
    openSessions.error,
    t("attendanceDataUnavailable"),
    openSessions.refetch,
  );

  if (!canPresence) {
    return <AccessDenied ask={t("presenceDeniedDesc")} />;
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("presence")} />
      <Tabs value={tab} onValueChange={(value) => setTab(value)}>
        <TabBar aria-label={t("presenceSections")} className="w-full justify-start">
          <TabsTrigger value="scan">{t("presenceScanTab")}</TabsTrigger>
          <TabsTrigger value="sessions">{t("presenceSessionsTab")}</TabsTrigger>
          <TabsTrigger value="hours">{t("presenceHoursTab")}</TabsTrigger>
        </TabBar>
      </Tabs>
      {tab === "sessions" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={t("presentNow")}
            value={estimate.data?.presentCount ?? "—"}
            icon={UsersIcon}
            hint={estimate.connected ? t("liveEstimate") : t("reconnectsAutomatically")}
            footer={estimateError && <ContextualError {...estimateError} />}
          />
          <StatCard
            label={t("openSessions")}
            value={openSessions.data?.length ?? "—"}
            icon={DoorOpenIcon}
            hint={t("enteredNotExited")}
            footer={openSessionsError && <ContextualError {...openSessionsError} />}
          />
          <StatCard
            label={t("staleSessions")}
            value={openSessions.data?.filter((s) => s.stale).length ?? "—"}
            icon={AlertTriangleIcon}
            hint={t("staleSessionsHint")}
            footer={openSessionsError && <ContextualError {...openSessionsError} />}
          />
        </div>
      )}
      <PresencePanel
        view={tab}
        hours={hours.data ?? []}
        loading={hours.loading}
        hoursError={hoursError}
        openSessions={openSessions.data ?? []}
        openSessionsLoading={openSessions.loading}
        openSessionsError={openSessionsError}
        onScanned={() => {
          estimate.refetch();
          hours.refetch();
          openSessions.refetch();
        }}
      />
    </div>
  );
}

function PresencePanel({
  view,
  hours,
  loading,
  hoursError,
  openSessions,
  openSessionsLoading,
  openSessionsError,
  onScanned,
}: {
  view: PresenceTab;
  hours: PresenceHours[];
  loading: boolean;
  hoursError?: { message: string; onRetry: () => void };
  openSessions: OpenPresenceSession[];
  openSessionsLoading: boolean;
  openSessionsError?: { message: string; onRetry: () => void };
  onScanned: () => void;
}) {
  const { language, t } = useLocale();
  const timeFmt = new Intl.DateTimeFormat(LOCALE_CODES[language], TIME_FORMAT_OPTIONS);
  const [badgeId, setBadgeId] = useState("");
  const [lookup, setLookup] = useState<PresenceLookup | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKind, setManualKind] = useState<"in" | "out">("in");
  const [manualScannedAt, setManualScannedAt] = useState("");
  const [recentScan, setRecentScan] = useState<{
    kind: "in" | "out";
    person: string;
    at: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setBadgeId("");
    setLookup(null);
    setManualOpen(false);
    setManualScannedAt("");
  };

  const doLookup = async () => {
    if (!badgeId.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.presenceLookup(badgeId.trim());
      setLookup(result);
      setManualKind(result.pendingExit || result.openSince ? "out" : "in");
    } catch (err) {
      setLookup(null);
      setError(errorMessage(err, t("badgeLookupFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doScan = async (kind: "in" | "out") => {
    if (!lookup) return;
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.presenceScan({ badgeId: lookup.badgeId, kind });
      setRecentScan({ kind, person: personName(lookup), at: result.scannedAt });
      toast.success(kind === "in" ? t("entryRecorded") : t("exitRecorded"));
      reset();
      onScanned();
    } catch (err) {
      setError(errorMessage(err, t("presenceScanFailed")));
    } finally {
      setBusy(false);
    }
  };

  const doManualSave = async () => {
    if (!lookup || !manualScannedAt) return;
    const kind = lookup.pendingExit ? "out" : manualKind;
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.presenceScan({
        badgeId: lookup.badgeId,
        kind,
        scannedAt: new Date(manualScannedAt).toISOString(),
      });
      setRecentScan({ kind, person: personName(lookup), at: result.scannedAt });
      toast.success(t("manualRecordAdded"));
      reset();
      onScanned();
    } catch (err) {
      setError(errorMessage(err, t("couldNotSaveManualRecord")));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<PresenceHours>[] = [
    {
      id: "user",
      header: t("columnUser"),
      sortValue: (row) => `${row.surname ?? ""} ${row.name ?? ""}`.trim().toLowerCase(),
      cell: (row) => {
        const name = [row.name, row.surname].filter(Boolean).join(" ").trim();
        return name ? (
          <span>{name}</span>
        ) : (
          <span className="text-muted-foreground font-mono text-sm">#{row.userId}</span>
        );
      },
    },
    {
      id: "hours",
      header: t("columnHours"),
      align: "right",
      sortValue: (row) => row.hours,
      cell: (row) => <span className="font-mono tabular-nums">{row.hours.toFixed(2)}</span>,
    },
  ];

  return (
    <div className="grid gap-4">
      {view === "scan" && (
        <SectionCard
          title={t("doorScan")}
          description={t("doorScanDesc")}
          icon={DoorOpenIcon}
          bodyClassName="space-y-4"
        >
          {recentScan && (
            <div
              className="border-success/40 bg-success/10 text-success-foreground flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm"
              role="status"
              aria-live="polite"
            >
              <CheckCircle2Icon
                className="text-success mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-medium">
                  {recentScan.kind === "in" ? t("entryRecorded") : t("exitRecorded")}
                </p>
                <p className="text-muted-foreground truncate">
                  {t("lastPresenceScan", {
                    person: recentScan.person,
                    time: timeFmt.format(new Date(recentScan.at)),
                  })}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
            <Field id="presence-badge" label={t("badge")}>
              <Input
                id="presence-badge"
                value={badgeId}
                onChange={(e) => setBadgeId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doLookup();
                }}
                placeholder={t("badgePlaceholder")}
                autoComplete="off"
              />
            </Field>
            <div className="flex items-end">
              <Button className="w-full" onClick={doLookup} disabled={busy || !badgeId.trim()}>
                <ScanLineIcon className="size-4" />
                {t("lookup")}
              </Button>
            </div>
          </div>

          {error && <InlineError message={error} />}

          {lookup && (
            <>
              <PersonCardView card={lookup} />
              {lookup.openSince && (
                <div className="border-warning/40 bg-warning/10 text-warning-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <AlertTriangleIcon className="size-4 shrink-0" />
                  {t("alreadyOpenSession", {
                    time: timeFmt.format(new Date(lookup.openSince)),
                    hours: hoursSince(lookup.openSince, t),
                  })}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  variant={lookup.openSince ? "outline" : "default"}
                  onClick={() => doScan("in")}
                  disabled={busy || !!lookup.openSince || lookup.pendingExit === true}
                >
                  <LogInIcon className="size-4" />
                  {t("registerEntry")}
                </Button>
                <Button
                  variant={lookup.openSince ? "default" : "outline"}
                  onClick={() => doScan("out")}
                  disabled={busy || !lookup.openSince}
                >
                  <LogOutIcon className="size-4" />
                  {t("registerExit")}
                </Button>
              </div>

              <div className="border-t pt-4">
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => setManualOpen((v) => !v)}
                >
                  <ClockIcon className="size-4" />
                  {manualOpen ? t("cancelManualRecord") : t("addManualRecord")}
                </Button>
              </div>

              {manualOpen && (
                <div className="bg-muted/40 space-y-3 rounded-lg border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="presence-manual-direction" label={t("directionLabel")}>
                      <Select
                        value={manualKind}
                        onValueChange={(v) => setManualKind(v as "in" | "out")}
                      >
                        <SelectTrigger id="presence-manual-direction" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in" disabled={lookup.pendingExit === true}>
                            {t("entryOption")}
                          </SelectItem>
                          <SelectItem value="out">{t("exitOption")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field id="presence-manual-time" label={t("timeLabel")}>
                      <DateTimeInput
                        id="presence-manual-time"
                        value={manualScannedAt}
                        onChange={setManualScannedAt}
                      />
                    </Field>
                  </div>
                  <Button
                    variant="outline"
                    onClick={doManualSave}
                    disabled={
                      busy || !manualScannedAt || (lookup.pendingExit === true && !lookup.openSince)
                    }
                  >
                    {t("saveManualRecord")}
                  </Button>
                </div>
              )}
            </>
          )}
        </SectionCard>
      )}

      {view === "hours" && (
        <SectionCard
          title={t("attendanceHours")}
          description={t("attendanceHoursDesc")}
          icon={UsersIcon}
        >
          <DataTable
            columns={columns}
            data={hours}
            getRowId={(row) => String(row.userId)}
            getRowHref={(row) => `/users/${row.userId}?tab=presence`}
            getRowLabel={(row) =>
              `${row.name ?? ""} ${row.surname ?? ""}`.trim() || String(row.userId)
            }
            loading={loading}
            searchable={(row) =>
              `${row.userId} ${row.name ?? ""} ${row.surname ?? ""} ${row.hours}`
            }
            searchPlaceholder={t("filterUsers")}
            pageSize={10}
            error={hoursError}
            empty={{
              icon: UsersIcon,
              title: t("noPresenceYet"),
              description: t("noPresenceYetDesc"),
            }}
          />
        </SectionCard>
      )}

      {view === "sessions" && (
        <SectionCard
          title={t("openSessions")}
          description={t("openSessionsDesc")}
          icon={AlertTriangleIcon}
          className="xl:col-span-2"
        >
          <DataTable
            columns={getOpenSessionColumns(t, timeFmt)}
            data={openSessions}
            getRowId={(row) =>
              row.userId != null ? `user:${row.userId}` : `pending:${row.sessionId}`
            }
            getRowLabel={(row) =>
              `${row.name ?? ""} ${row.surname ?? ""}`.trim() ||
              (row.userId != null ? String(row.userId) : t("reviewSession"))
            }
            loading={openSessionsLoading}
            searchable={(row) => `${row.userId ?? ""} ${row.name ?? ""} ${row.surname ?? ""}`}
            searchPlaceholder={t("filterUsers")}
            pageSize={10}
            error={openSessionsError}
            empty={{
              icon: DoorOpenIcon,
              title: t("noOpenSessions"),
              description: t("noOpenSessionsDesc"),
            }}
          />
        </SectionCard>
      )}
    </div>
  );
}

function getOpenSessionColumns(
  t: Translate,
  timeFmt: Intl.DateTimeFormat,
): Column<OpenPresenceSession>[] {
  return [
    {
      id: "user",
      header: t("columnUser"),
      sortValue: (row) => `${row.surname ?? ""} ${row.name ?? ""}`.trim().toLowerCase(),
      cell: (row) => {
        const name = [row.name, row.surname].filter(Boolean).join(" ").trim();
        return name ? (
          <span>{name}</span>
        ) : (
          <span className="text-muted-foreground font-mono text-sm">
            {row.userId != null ? `#${row.userId}` : "—"}
          </span>
        );
      },
    },
    {
      id: "since",
      header: t("columnEntered"),
      sortValue: (row) => row.since,
      cell: (row) => <span className="text-sm">{timeFmt.format(new Date(row.since))}</span>,
    },
    {
      id: "lastSignal",
      header: t("columnLastSignal"),
      sortValue: (row) => row.lastSignal,
      cell: (row) => (
        <span className="text-sm">
          {timeFmt.format(new Date(row.lastSignal))} ({hoursSince(row.lastSignal, t)})
        </span>
      ),
    },
    {
      id: "stale",
      header: t("statusColumn"),
      cell: (row) => (
        <StatusBadge tone={row.stale ? "warning" : "neutral"} dot={false}>
          {row.stale ? t("staleCheck") : t("fresh")}
        </StatusBadge>
      ),
    },
    {
      id: "review",
      header: t("columnActions"),
      align: "right",
      cell: (row) =>
        row.userId == null ? null : (
          <Button asChild size="sm" variant="outline">
            <Link href={`/users/${row.userId}?tab=presence`}>{t("reviewSession")}</Link>
          </Button>
        ),
    },
  ];
}
