"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { ArrowRightIcon, TicketIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Spinner } from "@/components/common/spinner";
import { TabBar } from "@/components/common/tab-bar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { type SseEnvelope, useLiveQuery } from "@/hooks/use-event-source";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  enqueueAllChallengeQueues,
  getAllRoomViews,
  getOperatorArrivalAcks,
  type RoomView,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import { GenerateQueuesAction } from "./generate-queues-action";
import { QueueOperatorConsole } from "./operator-console";
import { QueuesPanel } from "./queues-panel";

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
      EVENTS.QUEUE_OPERATOR_ARRIVAL_CHANGED,
    ],
    { enabled: canUse, onEvent: announceTeamEnter },
  );

  const operatorArrivals = useLiveQuery(
    () => getOperatorArrivalAcks(),
    "/api/queue/stream",
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_TEAM_CALLED, EVENTS.QUEUE_OPERATOR_ARRIVAL_CHANGED],
    { enabled: canUse },
  );

  const rooms = useMemo(() => roomViews.data ?? [], [roomViews.data]);

  const onGenerate = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enqueueAllChallengeQueues(crypto.randomUUID());
      toast.success(
        t("queuesGenerated", { inserted: result.inserted, challenges: result.challenges.length }),
      );
      roomViews.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotGenerateQueues"));
    } finally {
      setBusy(false);
    }
  }, [roomViews, t]);

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
          canAdmin ? (
            <GenerateQueuesAction busy={busy} onGenerate={() => void onGenerate()} />
          ) : undefined
        }
        secondaryActions={
          <>
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
            <Button variant="outline" asChild>
              <Link href="/judging">
                <ArrowRightIcon className="size-4" />
                {t("openJudging")}
              </Link>
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabBar aria-label={t("queueOperations")} className="w-full justify-start">
          <TabsTrigger value="rooms">{t("rooms")}</TabsTrigger>
          <TabsTrigger value="queues">{t("judgingQueues")}</TabsTrigger>
        </TabBar>

        <TabsContent value="rooms" className="pt-2">
          {rooms.length === 0 ? (
            <EmptyState
              icon={TicketIcon}
              title={t("noRoomsYet")}
              description={t("noRoomsYetDescription")}
            />
          ) : (
            <QueueOperatorConsole
              rooms={rooms}
              arrivalAcks={operatorArrivals.data ?? []}
              canOperate={can(CAPABILITIES.QUEUE_OPERATE) || canAdmin}
              onChanged={() => {
                roomViews.refetch();
                operatorArrivals.refetch();
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="queues" className="pt-2">
          <QueuesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
