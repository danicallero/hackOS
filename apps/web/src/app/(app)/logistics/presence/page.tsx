"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { DoorOpenIcon, LockIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
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
import { logisticsApi, type PresenceEstimate, type PresenceHours } from "@/lib/logistics";
import { useCan } from "@/lib/session";

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
        description="Register entries and exits at the door; attendance hours are estimated from all signals (H24)."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Present now"
          value={estimate.data?.presentCount ?? "—"}
          icon={UsersIcon}
          hint={estimate.connected ? "Live estimate" : "Reconnects automatically"}
        />
      </div>
      <PresencePanel
        hours={hours.data ?? []}
        loading={hours.loading}
        onScanned={() => {
          estimate.refetch();
          hours.refetch();
        }}
      />
    </div>
  );
}

function PresencePanel({
  hours,
  loading,
  onScanned,
}: {
  hours: PresenceHours[];
  loading: boolean;
  onScanned: () => void;
}) {
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
      onScanned();
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
