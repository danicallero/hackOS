"use client";

// One judging queue, as a page (H46). This is a record's own detail — the
// queue itself, its teams in call order, the rooms working it — so it is a
// route, not a dialog (DESIGN.md §5 "Is it a dialog at all?"): a live,
// scannable list that operators link to, keep open beside the judging panel,
// and come back to.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import type { Question } from "@hackos/shared/questions";
import { Building2Icon, LayersIcon, SearchIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { BackLink } from "@/components/common/back-link";
import { EmptyState } from "@/components/common/empty-state";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { JudgingPanelBuilder, normalizeQuestions } from "@/components/common/questionnaire-builder";
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
  getAssignableRooms,
  getQueueGroupQueue,
  listQueueGroups,
  moveQueueEntry,
  type QueueGroup,
  type QueueGroupQueue,
  setQueueGroupRooms,
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
  const [assignableRooms, setAssignableRooms] = useState<
    Array<{ id: number; name: string; queueGroupId: number | null }>
  >([]);
  const [roomIds, setRoomIds] = useState<number[]>([]);
  const [criteria, setCriteria] = useState<Question[]>([]);
  const [search, setSearch] = useState("");
  const [movePositions, setMovePositions] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [roomsBusy, setRoomsBusy] = useState(false);
  const [criteriaBusy, setCriteriaBusy] = useState(false);

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
      setCriteria(found?.criteria ?? []);
      if (found) {
        const rooms = await getAssignableRooms(found.enterpriseId);
        setAssignableRooms(rooms);
        setRoomIds(found.rooms.map((room) => room.id));
      }
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

  const filteredEntries = useMemo(() => {
    const entries = queue?.entries ?? [];
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.repo_name, entry.challenge_title, String(entry.repo_id)].some((value) =>
        value.toLocaleLowerCase().includes(needle),
      ),
    );
  }, [queue?.entries, search]);

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
      const updated = await updateQueueGroup(queueGroupId, { displayName: name.trim() });
      setMeta(updated);
      setName(updated.displayName);
      toast.success(t("queueRenamed"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveQueue"));
    } finally {
      setBusy(false);
    }
  };

  const shared = Boolean(meta?.shared);

  const saveRooms = async (nextRoomIds: string[]) => {
    const next = nextRoomIds.map(Number);
    const previous = roomIds;
    setRoomIds(next);
    setRoomsBusy(true);
    try {
      const updated = await setQueueGroupRooms(queueGroupId, next);
      setMeta(updated);
      toast.success(t("queueRoomsSaved"));
    } catch (err) {
      setRoomIds(previous);
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveQueueRooms"));
    } finally {
      setRoomsBusy(false);
    }
  };

  const saveCriteria = async () => {
    setCriteriaBusy(true);
    try {
      const normalized = normalizeQuestions(criteria);
      const updated = await updateQueueGroup(queueGroupId, { criteria: normalized });
      setMeta(updated);
      setCriteria(updated.criteria ?? []);
      toast.success(t("queueCriteriaSaved"));
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t("couldNotSaveQueueCriteria"),
      );
    } finally {
      setCriteriaBusy(false);
    }
  };

  const moveTeam = async (entryId: number, position: number) => {
    setMovePositions((current) => ({ ...current, [entryId]: String(position) }));
    setBusy(true);
    try {
      await moveQueueEntry(entryId, position);
      await load();
      toast.success(t("queueTeamMoved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotMoveQueueTeam"));
    } finally {
      setBusy(false);
    }
  };

  const sendTeamToEnd = async (entryId: number) => {
    setBusy(true);
    try {
      // The API clamps out-of-range ranks to the queue's last position.
      await moveQueueEntry(entryId, 1_000_000_000);
      await load();
      toast.success(t("queueTeamSentToEnd"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotMoveQueueTeam"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <BackLink href="/queue?tab=queues" label={t("queueOperations")} />
      <PageHeader
        title={queue.group.display_name}
        meta={
          <>
            <span>{queue.group.enterprise_name}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {t("queueSummary", {
                challenges: queue.challenges.length,
                rooms: meta?.rooms.length ?? 0,
                teams: meta?.teams ?? queue.entries.length,
              })}
            </span>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <SectionCard
          title={t("queueTeams")}
          icon={LayersIcon}
          state={<StatusBadge>{filteredEntries.length}</StatusBadge>}
          bodyClassName="p-0"
        >
          {queue.entries.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={LayersIcon} title={t("queueEmpty")} />
            </div>
          ) : filteredEntries.length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">{t("noMatchingQueueTeams")}</p>
          ) : (
            <>
              <div className="border-border border-b p-4 sm:px-5">
                <Label htmlFor="queue-team-search" className="sr-only">
                  {t("searchQueueTeams")}
                </Label>
                <div className="relative">
                  <SearchIcon
                    aria-hidden="true"
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  />
                  <Input
                    id="queue-team-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("searchQueueTeamsPlaceholder")}
                    className="pl-9"
                  />
                </div>
              </div>
              <ol className="divide-border divide-y">
                {filteredEntries.map((entry) => {
                  const movable = entry.status === "waiting" || entry.status === "called";
                  const requestedPosition = movePositions[entry.id] ?? String(entry.position ?? "");
                  const parsedPosition = Number(requestedPosition);
                  const canMove = Number.isInteger(parsedPosition) && parsedPosition > 0;
                  return (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                    >
                      <span className="text-muted-foreground w-6 shrink-0 text-right text-sm tabular-nums">
                        {entry.position ?? "—"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/projects/${entry.repo_id}`}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {entry.repo_name}
                        </Link>
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
                      {movable && (
                        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                          <Label htmlFor={`move-position-${entry.id}`} className="sr-only">
                            {t("moveTeamToPosition", { team: entry.repo_name })}
                          </Label>
                          <Input
                            id={`move-position-${entry.id}`}
                            type="number"
                            min={1}
                            inputMode="numeric"
                            value={requestedPosition}
                            onChange={(event) =>
                              setMovePositions((current) => ({
                                ...current,
                                [entry.id]: event.target.value,
                              }))
                            }
                            className="h-8 w-20 text-center tabular-nums"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !canMove}
                            onClick={() => void moveTeam(entry.id, parsedPosition)}
                          >
                            {t("moveTeam")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void sendTeamToEnd(entry.id)}
                          >
                            {t("sendToEnd")}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
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
            <div className="space-y-2 px-4 py-4 sm:px-5">
              <Label htmlFor="queue-rooms" className="sr-only">
                {t("rooms")}
              </Label>
              <MultiSelect
                id="queue-rooms"
                value={roomIds.map(String)}
                options={assignableRooms.map((room) => ({
                  value: String(room.id),
                  label: room.name,
                }))}
                onChange={(next) => void saveRooms(next)}
                placeholder={t("selectRoomsPlaceholder")}
                searchPlaceholder={t("searchRoomsPlaceholder")}
                emptyText={t("noAssignableRooms")}
                aria-label={t("rooms")}
                disabled={roomsBusy}
              />
              {roomIds.length === 0 && (
                <p className="text-muted-foreground text-xs">{t("noRoomServingQueue")}</p>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {shared && meta && (
        <SectionCard
          title={t("mergedJudgingForm")}
          icon={TrophyIcon}
          description={meta.evaluationStarted ? t("queueCriteriaLocked") : undefined}
          footer={
            !meta.evaluationStarted ? (
              <Button onClick={() => void saveCriteria()} disabled={criteriaBusy}>
                {t("saveQueueCriteria")}
              </Button>
            ) : undefined
          }
        >
          {meta.evaluationStarted ? (
            <ul className="space-y-2">
              {criteria.map((question) => (
                <li key={question.key} className="rounded-md border px-3 py-2 text-sm">
                  {question.label.en || question.key}
                </li>
              ))}
            </ul>
          ) : (
            <JudgingPanelBuilder value={criteria} onChange={setCriteria} disabled={criteriaBusy} />
          )}
        </SectionCard>
      )}
    </div>
  );
}
