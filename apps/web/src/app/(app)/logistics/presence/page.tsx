"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  AlertTriangleIcon,
  ClockIcon,
  DoorOpenIcon,
  LockIcon,
  LogInIcon,
  LogOutIcon,
  ScanLineIcon,
  UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
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
import { useLiveQuery } from "@/hooks/use-event-source";
import {
  logisticsApi,
  type OpenPresenceSession,
  type PresenceEstimate,
  type PresenceHours,
  type PresenceLookup,
} from "@/lib/logistics";
import { useCan } from "@/lib/session";

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function hoursSince(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? "<1h ago" : `${Math.round(h)}h ago`;
}

const PRESENCE_EVENTS = [EVENTS.LOGISTICS_PRESENCE_SCAN, EVENTS.LOGISTICS_ACTIVITY_SCAN];

export default function PresencePage() {
  const canPresence = useCan(CAPABILITIES.PRESENCE_SCAN);

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

  if (!canPresence) {
    return (
      <div className="space-y-6">
        <PageHeader title="Presence" />
        <EmptyState
          icon={LockIcon}
          title="You can't scan presence"
          description="The presence scan capability is required."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title="Presence"
        description="Scan a badge at the door to register an entry or exit; attendance hours are estimated from all signals (H24)."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Present now"
          value={estimate.data?.presentCount ?? "—"}
          icon={UsersIcon}
          hint={estimate.connected ? "Live estimate" : "Reconnects automatically"}
        />
        <StatCard
          label="Open sessions"
          value={openSessions.data?.length ?? "—"}
          icon={DoorOpenIcon}
          hint="Entered, not yet exited"
        />
        <StatCard
          label="Stale sessions"
          value={openSessions.data?.filter((s) => s.stale).length ?? "—"}
          icon={AlertTriangleIcon}
          hint="No signal in a while — needs reconciling"
        />
      </div>
      <PresencePanel
        hours={hours.data ?? []}
        loading={hours.loading}
        openSessions={openSessions.data ?? []}
        openSessionsLoading={openSessions.loading}
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
  hours,
  loading,
  openSessions,
  openSessionsLoading,
  onScanned,
}: {
  hours: PresenceHours[];
  loading: boolean;
  openSessions: OpenPresenceSession[];
  openSessionsLoading: boolean;
  onScanned: () => void;
}) {
  const router = useRouter();
  const [badgeId, setBadgeId] = useState("");
  const [lookup, setLookup] = useState<PresenceLookup | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKind, setManualKind] = useState<"in" | "out">("in");
  const [manualScannedAt, setManualScannedAt] = useState("");
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
      setManualKind(result.openSince ? "out" : "in");
    } catch (err) {
      setLookup(null);
      setError(errorMessage(err, "Badge lookup failed."));
    } finally {
      setBusy(false);
    }
  };

  const doScan = async (kind: "in" | "out") => {
    if (!lookup) return;
    setBusy(true);
    setError("");
    try {
      await logisticsApi.presenceScan({ badgeId: lookup.badgeId, kind });
      toast.success(kind === "in" ? "Entry recorded." : "Exit recorded.");
      reset();
      onScanned();
    } catch (err) {
      setError(errorMessage(err, "Presence scan failed."));
    } finally {
      setBusy(false);
    }
  };

  const doManualSave = async () => {
    if (!lookup || !manualScannedAt) return;
    setBusy(true);
    setError("");
    try {
      await logisticsApi.presenceScan({
        badgeId: lookup.badgeId,
        kind: manualKind,
        scannedAt: new Date(manualScannedAt).toISOString(),
      });
      toast.success("Manual record added.");
      reset();
      onScanned();
    } catch (err) {
      setError(errorMessage(err, "Could not save the manual record."));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<PresenceHours>[] = [
    {
      id: "user",
      header: "User",
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
        description="Scan a badge to load the person, then register an entry or exit."
        icon={DoorOpenIcon}
        bodyClassName="space-y-4"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
          <Field label="Badge">
            <Input
              value={badgeId}
              onChange={(e) => setBadgeId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doLookup();
              }}
              placeholder="scan badge"
              autoComplete="off"
            />
          </Field>
          <div className="flex items-end">
            <Button className="w-full" onClick={doLookup} disabled={busy || !badgeId.trim()}>
              <ScanLineIcon className="size-4" />
              Lookup
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
                Already has an open session since {timeFmt.format(new Date(lookup.openSince))} (
                {hoursSince(lookup.openSince)}). Register an exit before a new entry.
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                variant={lookup.openSince ? "outline" : "default"}
                onClick={() => doScan("in")}
                disabled={busy || !!lookup.openSince}
              >
                <LogInIcon className="size-4" />
                Register entry
              </Button>
              <Button
                variant={lookup.openSince ? "default" : "outline"}
                onClick={() => doScan("out")}
                disabled={busy || !lookup.openSince}
              >
                <LogOutIcon className="size-4" />
                Register exit
              </Button>
            </div>

            <div className="border-t pt-4">
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => setManualOpen((v) => !v)}
              >
                <ClockIcon className="size-4" />
                {manualOpen ? "Cancel manual record" : "Add a backdated manual record"}
              </Button>
            </div>

            {manualOpen && (
              <div className="bg-muted/40 space-y-3 rounded-lg border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Direction">
                    <Select
                      value={manualKind}
                      onValueChange={(v) => setManualKind(v as "in" | "out")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in">Entry</SelectItem>
                        <SelectItem value="out">Exit</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Time">
                    <Input
                      type="datetime-local"
                      value={manualScannedAt}
                      onChange={(e) => setManualScannedAt(e.target.value)}
                    />
                  </Field>
                </div>
                <Button
                  variant="outline"
                  onClick={doManualSave}
                  disabled={busy || !manualScannedAt}
                >
                  Save manual record
                </Button>
              </div>
            )}
          </>
        )}
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
          onRowClick={(row) => router.push(`/users/${row.userId}?tab=presence`)}
          loading={loading}
          searchable={(row) => `${row.userId} ${row.name ?? ""} ${row.surname ?? ""} ${row.hours}`}
          searchPlaceholder="Filter users..."
          pageSize={10}
          empty={{
            icon: UsersIcon,
            title: "No presence yet",
            description: "Door, meal or activity scans will appear here.",
          }}
        />
      </SectionCard>

      <SectionCard
        title="Open sessions"
        description="Entered but not yet exited. The system never closes these — reconcile stale ones with a manual exit."
        icon={AlertTriangleIcon}
        className="xl:col-span-2"
      >
        <DataTable
          columns={openSessionColumns}
          data={openSessions}
          getRowId={(row) => String(row.userId)}
          onRowClick={(row) => router.push(`/users/${row.userId}?tab=presence`)}
          loading={openSessionsLoading}
          searchable={(row) => `${row.userId} ${row.name ?? ""} ${row.surname ?? ""}`}
          searchPlaceholder="Filter users..."
          pageSize={10}
          empty={{
            icon: DoorOpenIcon,
            title: "No open sessions",
            description: "Everyone who entered has also exited.",
          }}
        />
      </SectionCard>
    </div>
  );
}

const openSessionColumns: Column<OpenPresenceSession>[] = [
  {
    id: "user",
    header: "User",
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
    id: "since",
    header: "Entered",
    sortValue: (row) => row.since,
    cell: (row) => <span className="text-sm">{timeFmt.format(new Date(row.since))}</span>,
  },
  {
    id: "lastSignal",
    header: "Last signal",
    sortValue: (row) => row.lastSignal,
    cell: (row) => (
      <span className="text-sm">
        {timeFmt.format(new Date(row.lastSignal))} ({hoursSince(row.lastSignal)})
      </span>
    ),
  },
  {
    id: "stale",
    header: "Status",
    cell: (row) => (
      <StatusBadge tone={row.stale ? "warning" : "neutral"} dot={false}>
        {row.stale ? "Stale — check" : "Fresh"}
      </StatusBadge>
    ),
  },
];
