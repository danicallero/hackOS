"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { Building2Icon, TicketIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { TabBar } from "@/components/common/tab-bar";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { type SseEnvelope, useLiveQuery } from "@/hooks/use-event-source";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  enqueueAllChallengeQueues,
  getAllRoomViews,
  getRoomAssignments,
  type RoomAssignments,
  type RoomView,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import { GenerateQueuesAction } from "./generate-queues-action";
import { QueuesPanel } from "./queues-panel";
import { RoomQueueCard } from "./room-queue-card";

export default function QueueOperationsPage() {
  const { t } = useLocale();
  const { can, canAny } = useSessionContext();
  const canUse = canAny(
    CAPABILITIES.QUEUE_OPERATE,
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.JUDGE_PANEL,
  );
  const canAdmin = can(CAPABILITIES.QUEUE_ADMIN);
  // Two projections of the same thing (DESIGN §5: sub-views are a TabBar, not
  // another nav item): rooms working queues, and the queues themselves. A
  // queue no room serves is only reachable from the second.
  const { tab, setTab } = useUrlTab({
    values: ["rooms", "queues"] as const,
    defaultValue: "rooms",
  });
  const [busy, setBusy] = useState(false);
  const [roomAssignments, setRoomAssignments] = useState<Record<number, RoomAssignments | null>>(
    {},
  );
  const [arrivalHints, setArrivalHints] = useState(
    () => window.localStorage.getItem("queue-ops-arrival-hints") === "1",
  );
  const arrivalHintsRef = useRef(arrivalHints);

  // Keep ref in sync with state for use in event handlers
  useEffect(() => {
    arrivalHintsRef.current = arrivalHints;
  }, [arrivalHints]);
  const toggleArrivalHints = useCallback((checked: boolean) => {
    setArrivalHints(checked);
    arrivalHintsRef.current = checked;
    window.localStorage.setItem("queue-ops-arrival-hints", checked ? "1" : "0");
  }, []);

  const announceTeamEnter = useCallback(
    (event: SseEnvelope) => {
      if (event.type === EVENTS.QUEUE_TEAM_CALLED) {
        if (!arrivalHintsRef.current) return;
        if (!event.data || typeof event.data !== "object") return;
        const data = event.data as Record<string, unknown>;
        const team = typeof data.teamName === "string" ? data.teamName : t("challengeFallback");
        const room = typeof data.roomName === "string" ? data.roomName : t("noLocation");
        toast.info(t("teamShouldArrive", { team, room }), { duration: 10_000 });
        return;
      }
      if (event.type !== EVENTS.QUEUE_NOTIFY_ENTER || !event.data || typeof event.data !== "object")
        return;
      const data = event.data as Record<string, unknown>;
      const team = typeof data.team_name === "string" ? data.team_name : t("challengeFallback");
      const room = typeof data.room_name === "string" ? data.room_name : null;
      toast.info(room ? `${team} · ${room}` : team, {
        description: t("teamAskedToEnter"),
        duration: 10_000,
      });
    },
    [t],
  );

  const roomViews = useLiveQuery<RoomView[]>(
    () => getAllRoomViews(),
    "/api/queue/stream",
    [
      EVENTS.QUEUE_ENTRY_CHANGED,
      EVENTS.QUEUE_ROOM_CHANGED,
      EVENTS.QUEUE_NOTIFY_ENTER,
      EVENTS.QUEUE_TEAM_CALLED,
    ],
    { enabled: canUse, onEvent: announceTeamEnter },
  );

  const rooms = useMemo(() => roomViews.data ?? [], [roomViews.data]);

  const loadAdminData = useCallback(async () => {
    if (!canAdmin) {
      setRoomAssignments({});
      return;
    }
    try {
      const assignmentPromise =
        rooms.length > 0 ? Promise.all(rooms.map((room) => getRoomAssignments(room.room.id))) : [];
      const assignmentRows = await assignmentPromise;
      const nextAssignments: Record<number, RoomAssignments> = {};
      for (const item of assignmentRows as RoomAssignments[]) nextAssignments[item.roomId] = item;
      setRoomAssignments(nextAssignments);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadOperationsDetails"));
    }
  }, [canAdmin, rooms, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetch pattern: loadAdminData wraps setState for assignment queries
    void loadAdminData();
  }, [loadAdminData]);

  const onGenerate = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enqueueAllChallengeQueues(crypto.randomUUID());
      toast.success(
        t("queuesGenerated", { inserted: result.inserted, challenges: result.challenges.length }),
      );
      roomViews.refetch();
      await loadAdminData();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotGenerateQueues"));
    } finally {
      setBusy(false);
    }
  }, [loadAdminData, roomViews, t]);

  if (!canUse) {
    return <AccessDenied ask={t("queueOpsAccessDeniedDesc")} />;
  }

  if (roomViews.loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (roomViews.error) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("queueOperations")} />
        <EmptyState
          icon={TicketIcon}
          title={t("couldNotLoadQueueOps")}
          description={roomViews.error instanceof Error ? roomViews.error.message : t("tryAgain")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title={t("queueOperations")}
        primaryAction={
          canAdmin && tab === "queues" ? (
            <GenerateQueuesAction busy={busy} onGenerate={() => void onGenerate()} />
          ) : undefined
        }
        secondaryActions={
          tab === "rooms" ? (
            <label
              className="text-muted-foreground flex items-center gap-2 text-sm"
              htmlFor="arrival-hints"
              title={t("arrivalHintsDescription")}
            >
              <Switch
                id="arrival-hints"
                checked={arrivalHints}
                onCheckedChange={toggleArrivalHints}
              />
              {t("arrivalHints")}
            </label>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabBar aria-label={t("queueOperations")} className="w-full justify-start">
          <TabsTrigger value="rooms">{t("rooms")}</TabsTrigger>
          <TabsTrigger value="queues">{t("judgingQueues")}</TabsTrigger>
        </TabBar>

        <TabsContent value="rooms" className="pt-2">
          <SectionCard title={t("roomQueues")} icon={Building2Icon} bodyClassName="space-y-4">
            {rooms.length === 0 ? (
              <EmptyState
                icon={Building2Icon}
                title={t("noRoomsYet")}
                description={t("noRoomsYetDescription")}
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {rooms.map((room) => (
                  <RoomQueueCard
                    key={room.room.id}
                    room={room}
                    assignments={roomAssignments[room.room.id] ?? null}
                    canOperate={can(CAPABILITIES.QUEUE_OPERATE) || canAdmin}
                    onChanged={() => {
                      roomViews.refetch();
                      void loadAdminData();
                    }}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="queues" className="pt-2">
          <QueuesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
