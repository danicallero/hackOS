"use client";

// One judging queue, as a page (H46). This is a record's own detail — the
// queue itself, its teams in call order, the rooms working it — so it is a
// route, not a dialog (DESIGN.md §5 "Is it a dialog at all?"): a live,
// scannable list that operators link to, keep open beside the judging panel,
// and come back to.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { Building2Icon, LayersIcon, TrophyIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { BackLink } from "@/components/common/back-link";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  getQueueGroupQueue,
  listQueueGroups,
  type QueueGroup,
  type QueueGroupQueue,
  updateQueueGroup,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import { canAccessSponsorWorkspace } from "../../../challenges/shared";

export default function QueueDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const queueGroupId = Number(params.id);
  const { can, me } = useSessionContext();
  const canManage = canAccessSponsorWorkspace(
    can(CAPABILITIES.QUEUE_ADMIN),
    Boolean(me?.isSponsorRep),
  );

  const [queue, setQueue] = useState<QueueGroupQueue | null>(null);
  const [meta, setMeta] = useState<QueueGroup | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, groups] = await Promise.all([
        getQueueGroupQueue(queueGroupId),
        listQueueGroups(),
      ]);
      setQueue(detail);
      const found = groups.find((group) => group.id === queueGroupId) ?? null;
      setMeta(found);
      setName(found?.displayName ?? detail.group.display_name);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [queueGroupId]);

  const liveRefresh = useAutoRefresh("/api/queue/stream", [
    EVENTS.QUEUE_ENTRY_CHANGED,
    EVENTS.QUEUE_ROOM_CHANGED,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (!Number.isFinite(queueGroupId)) {
      setStatus("error");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, liveRefresh, queueGroupId]);

  if (!canManage) return <AccessDenied ask={t("roomAdminDeniedDesc")} />;

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (status === "error" || !queue) {
    return (
      <div className="space-y-6">
        <BackLink href="/queue?tab=queues" label={t("queueOperations")} />
        <EmptyState icon={LayersIcon} title={t("queueNotFound")} />
      </div>
    );
  }

  const rename = async () => {
    setBusy(true);
    try {
      await updateQueueGroup(queueGroupId, { displayName: name.trim() });
      await load();
      toast.success(t("queueRenamed"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveQueue"));
    } finally {
      setBusy(false);
    }
  };

  const shared = Boolean(meta?.shared);

  return (
    <div className="space-y-6">
      <BackLink href="/queue?tab=queues" label={t("queueOperations")} />
      <PageHeader
        title={queue.group.display_name}
        meta={queue.group.enterprise_name}
        state={
          shared ? (
            <StatusBadge tone="info">
              {t("sharedQueueBadge", { count: queue.challenges.length })}
            </StatusBadge>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <SectionCard
          title={t("queueTeams")}
          icon={LayersIcon}
          state={<StatusBadge>{queue.entries.length}</StatusBadge>}
          bodyClassName="p-0"
        >
          {queue.entries.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={LayersIcon} title={t("queueEmpty")} />
            </div>
          ) : (
            <ol className="divide-border divide-y">
              {queue.entries.map((entry, index) => (
                <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  {/* The call order, not the raw `position` integer: positions
                      are a sparse sort key, so the rank is what an operator
                      can actually reason about. */}
                  <span className="text-muted-foreground w-6 shrink-0 text-right text-sm tabular-nums">
                    {entry.status === "waiting" ? index + 1 : "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.repo_name}</p>
                    {shared && (
                      <p className="text-muted-foreground truncate text-xs">
                        {entry.challenge_title}
                      </p>
                    )}
                  </div>
                  {entry.room_name && (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {entry.room_name}
                    </span>
                  )}
                  <QueueStatusBadge status={entry.status} />
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title={t("queueName")} icon={LayersIcon}>
            <div className="space-y-2">
              <Label htmlFor="queue-name" className="sr-only">
                {t("queueName")}
              </Label>
              {/* A one-challenge queue is named by its challenge and follows a
                  rename of it; only a shared queue has a name of its own. */}
              <Input
                id="queue-name"
                value={name}
                disabled={!shared}
                onChange={(e) => setName(e.target.value)}
              />
              {shared && (
                <Button
                  variant="outline"
                  disabled={busy || !name.trim() || name.trim() === queue.group.display_name}
                  onClick={() => void rename()}
                >
                  {t("save")}
                </Button>
              )}
            </div>
          </SectionCard>

          <SectionCard title={t("challengesInThisQueue")} icon={TrophyIcon} bodyClassName="p-0">
            <ul className="divide-border divide-y">
              {queue.challenges.map((challenge) => (
                <li key={challenge.id} className="truncate px-4 py-2.5 text-sm sm:px-5">
                  {challenge.title}
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title={t("rooms")} icon={Building2Icon} bodyClassName="p-0">
            {meta && meta.rooms.length > 0 ? (
              <ul className="divide-border divide-y">
                {meta.rooms.map((room) => (
                  <li key={room.id} className="truncate px-4 py-2.5 text-sm sm:px-5">
                    {room.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground p-4 text-sm sm:p-5">{t("noRoomServingQueue")}</p>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
