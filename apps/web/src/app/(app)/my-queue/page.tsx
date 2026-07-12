"use client";

// Participant "my queue" status (H38): the authenticated user sees, for each
// project/challenge their team presents to, its live queue stage, position in
// line, estimated wait and assigned room. When their team is called they get a
// prominent "go to room X" notice; a pre-call gives them a heads-up to get
// ready. No capability gate — this is the participant-facing view, auth only.
//
// Data:
//   GET  /api/queue/me          → MyQueueEntry[] (read model, refetched by SSE)
//   GET  /api/queue/me/stream   → per-user SSE (only changes to one of the
//                                  participant's own challenge queues)
//
// Realtime (plan §4): the SSE payload is a signal, so we refetch the read model
// on every event (useLiveQuery). We additionally listen to the same stream to
// fire toasts and to capture the room *name* the call event carries — the read
// model only exposes `roomId`.

import { EVENTS } from "@hackos/shared/events";
import { DoorOpenIcon, HourglassIcon, TicketIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type SseEnvelope, useEventSource, useLiveQuery } from "@/hooks/use-event-source";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { getMyQueue, type MyQueueEntry } from "@/lib/queue";
import { cn } from "@/lib/utils";
import { type TranslatedText, textForDisplay } from "../challenges/shared";

/** Payload of `user.queue.called` (notify.ts): includes the human room name. */
type CalledPayload = { entryId: number; challengeId: number; roomId: number; roomName: string };
/** Payload of `user.queue.precall`. */
type PrecallPayload = { entryId: number; challengeId: number; etaMinutes: number };

const CALL_EVENTS = [
  EVENTS.USER_QUEUE_CALLED,
  EVENTS.USER_QUEUE_PRECALL,
  EVENTS.USER_QUEUE_CHANGED,
] as const;

function formatEta(minutes: number | null, anyMoment = "any moment now"): string | null {
  if (minutes == null) return null;
  if (minutes <= 0) return anyMoment;
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

function roomLabel(
  roomId: number | null,
  names: Record<number, string>,
  fallback = "your room",
  roomNumber = "room #{id}",
): string {
  if (roomId == null) return fallback;
  return names[roomId] ?? roomNumber.replace("{id}", String(roomId));
}

export default function MyQueuePage() {
  const { t } = useLocale();
  const {
    data: entries,
    error,
    loading,
  } = useLiveQuery<MyQueueEntry[]>(getMyQueue, "/api/queue/me/stream", CALL_EVENTS);

  // The read model only carries `roomId`; the call event carries the room name.
  // Cache names as we see them so the "go to room" notice reads nicely.
  const [roomNames, setRoomNames] = useState<Record<number, string>>({});
  // Queue entries that got a pre-call heads-up but haven't been called yet.
  const [precalled, setPrecalled] = useState<Set<number>>(new Set());

  // Guard against firing the same toast twice for one call (StrictMode / debounce).
  const seenCalls = useRef<Set<number>>(new Set());

  const onStreamEvent = useCallback(
    (env: SseEnvelope) => {
      if (env.type === EVENTS.USER_QUEUE_CALLED) {
        const p = env.data as CalledPayload;
        setRoomNames((prev) => (p.roomName ? { ...prev, [p.roomId]: p.roomName } : prev));
        setPrecalled((prev) => {
          if (!prev.has(p.entryId)) return prev;
          const next = new Set(prev);
          next.delete(p.entryId);
          return next;
        });
        if (!seenCalls.current.has(p.entryId)) {
          seenCalls.current.add(p.entryId);
          toast.success(t("yourTurn", { room: p.roomName ?? t("yourRoom") }), {
            duration: 12_000,
          });
        }
      } else if (env.type === EVENTS.USER_QUEUE_PRECALL) {
        const p = env.data as PrecallPayload;
        setPrecalled((prev) => new Set(prev).add(p.entryId));
        const eta = formatEta(p.etaMinutes, t("anyMoment"));
        toast(`${t("getReady")}${eta ? ` (${eta})` : ""}`);
      }
    },
    [t],
  );

  useEventSource("/api/queue/me/stream", { events: CALL_EVENTS, onEvent: onStreamEvent });

  useEffect(() => {
    if (error) {
      toast.error(error instanceof ApiError ? error.message : t("queueLoadError"));
    }
  }, [error, t]);

  const list = entries ?? [];
  const called = useMemo(() => list.filter((e) => e.status === "called"), [list]);
  const heading = useMemo(
    () => list.filter((e) => e.status === "waiting" && precalled.has(e.entryId)),
    [list, precalled],
  );
  const projects = useMemo(() => {
    const grouped = new Map<number, { repoName: string; entries: MyQueueEntry[] }>();
    for (const entry of list) {
      const project = grouped.get(entry.repoId) ?? { repoName: entry.repoName, entries: [] };
      project.entries.push(entry);
      grouped.set(entry.repoId, project);
    }
    return [...grouped.entries()].map(([repoId, project]) => ({ repoId, ...project }));
  }, [list]);

  if (loading && !entries) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("myQueue")} />
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("myQueue")} />

      {called.map((e) => (
        <CalledNotice key={`called-${e.repoId}-${e.challengeId}`} entry={e} roomNames={roomNames} />
      ))}

      {heading.map((e) => (
        <PrecallNotice key={`precall-${e.repoId}-${e.challengeId}`} entry={e} />
      ))}

      <SectionCard
        icon={TicketIcon}
        title={t("yourQueues")}
        bodyClassName={list.length === 0 ? "p-0" : "space-y-3"}
      >
        {list.length === 0 ? (
          <EmptyState icon={TicketIcon} title={t("noJudgingQueue")} />
        ) : (
          projects.map((project) => (
            <ProjectQueueCard key={project.repoId} {...project} roomNames={roomNames} />
          ))
        )}
      </SectionCard>
    </div>
  );
}

/** A project may be queued for several challenges; keep its live statuses together. */
function ProjectQueueCard({
  repoName,
  entries,
  roomNames,
}: {
  repoName: string;
  entries: MyQueueEntry[];
  roomNames: Record<number, string>;
}) {
  const { t } = useLocale();
  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardHeader className="gap-1 px-4 py-4">
        <p className="text-muted-foreground text-xs font-medium">{t("projectLabel")}</p>
        <CardTitle className="text-balance text-base">{repoName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 border-t px-4 py-3">
        {entries.map((entry) => (
          <QueueRow key={`${entry.repoId}-${entry.challengeId}`} entry={entry} roomNames={roomNames} />
        ))}
      </CardContent>
    </Card>
  );
}

function QueueRow({
  entry,
  roomNames,
}: {
  entry: MyQueueEntry;
  roomNames: Record<number, string>;
}) {
  const { t } = useLocale();
  const eta = formatEta(entry.etaMinutes, t("anyMoment"));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="truncate font-medium">
          {textForDisplay(entry.challengeTitle as TranslatedText)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {entry.status === "waiting" && entry.position != null && (
          <span className="text-muted-foreground">
            {t("position")} <span className="text-foreground font-semibold">#{entry.position}</span>
          </span>
        )}
        {entry.status === "waiting" && eta && <span className="text-muted-foreground">{eta}</span>}
        {entry.roomId != null && entry.status !== "waiting" && (
          <span className="text-muted-foreground capitalize">
            {roomLabel(entry.roomId, roomNames, t("yourRoom"), t("roomNumber"))}
          </span>
        )}
        <QueueStatusBadge status={entry.status} />
      </div>
    </div>
  );
}

/** H38: prominent "go to room X" call-to-action when the team is called. */
function CalledNotice({
  entry,
  roomNames,
}: {
  entry: MyQueueEntry;
  roomNames: Record<number, string>;
}) {
  const { t } = useLocale();
  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-xl border p-5",
        "border-success/40 bg-success/10 text-success",
      )}
    >
      <div className="bg-success/15 grid size-11 shrink-0 place-items-center rounded-full">
        <DoorOpenIcon className="size-5" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-base font-semibold">
          {t("yourTurn", {
            room: roomLabel(entry.roomId, roomNames, t("yourRoom"), t("roomNumber")),
          })}
        </p>
        <p className="text-success/90 text-sm">
          {textForDisplay(entry.challengeTitle as TranslatedText)} · {entry.repoName}
        </p>
      </div>
    </div>
  );
}

/** H38: gentle heads-up that a call is coming soon (pre-aviso). */
function PrecallNotice({ entry }: { entry: MyQueueEntry }) {
  const eta = formatEta(entry.etaMinutes);
  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-xl border p-5",
        "border-warning/40 bg-warning/10 text-warning",
      )}
    >
      <div className="bg-warning/15 grid size-11 shrink-0 place-items-center rounded-full">
        <HourglassIcon className="size-5" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-base font-semibold">You're up soon — get ready</p>
        <p className="text-warning/90 text-sm">
          {textForDisplay(entry.challengeTitle as TranslatedText)} · {entry.repoName}
          {eta ? ` · ${eta}` : ""}
        </p>
      </div>
    </div>
  );
}
