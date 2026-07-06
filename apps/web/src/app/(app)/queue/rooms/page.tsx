"use client";

// Queue admin surface for rooms and settings (H46, queue control follow-up).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ArrowLeftIcon, Building2Icon, CalendarClockIcon, LockIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DateTimeInput } from "@/components/common/datetime-input";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
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
import { ApiError, api } from "@/lib/api";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import {
  assignRoomChallenge,
  assignRoomJudge,
  createRoom,
  deleteRoom,
  getQueueSettings,
  getRoom,
  getRoomAssignments,
  listRooms,
  type QueueSettings,
  type Room,
  type RoomAssignments,
  type RoomQueueState,
  removeRoomChallenge,
  removeRoomJudge,
  updateQueueSettings,
  updateRoom,
  updateRoomState,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import type { UserList } from "@/lib/types";
import { type Challenge, textForDisplay } from "../../challenges/shared";

type RoomEditor = {
  name: string;
  slug: string;
  location: string;
  status: "active" | "paused";
};

function emptyRoomEditor(): RoomEditor {
  return { name: "", slug: "", location: "", status: "active" };
}

function emptySettings(): QueueSettings {
  return {
    id: 1,
    handoff_buffer_minutes: 0,
    schedule_start_at: null,
    schedule_end_at: null,
    pre_call_notification_eta_minutes: 3,
    requeue_prompt_default: "ask",
  };
}

export default function QueueRoomsPage() {
  const { can } = useSessionContext();
  const canAdmin = can(CAPABILITIES.QUEUE_ADMIN);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomState, setRoomState] = useState<Record<number, RoomQueueState | null>>({});
  const [assignments, setAssignments] = useState<Record<number, RoomAssignments | null>>({});
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [users, setUsers] = useState<UserList["users"]>([]);
  const [settings, setSettings] = useState<QueueSettings>(emptySettings());
  const [loading, setLoading] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [createDraft, setCreateDraft] = useState<RoomEditor>(emptyRoomEditor());
  const [roomDraft, setRoomDraft] = useState<RoomEditor>(emptyRoomEditor());
  const [stateDraft, setStateDraft] = useState<{
    maxInWaitingArea: number;
    desiredMinutesPerTeam: number;
  }>({
    maxInWaitingArea: 0,
    desiredMinutesPerTeam: 0,
  });
  const [saving, setSaving] = useState<string | null>(null);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  const selectedRoomQueueState = selectedRoom ? (roomState[selectedRoom.id] ?? null) : null;
  const selectedRoomAssignments = selectedRoom ? (assignments[selectedRoom.id] ?? null) : null;

  const selectedChallengeFallback = challenges[0]?.id ?? 0;

  const load = useCallback(async () => {
    if (!canAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [roomRows, challengeRows, userRows, queueSettings] = await Promise.all([
        listRooms(),
        api.get<{ challenges: Challenge[] }>("/api/challenges"),
        api.get<UserList>("/api/users", { query: { limit: 200 } }),
        getQueueSettings(),
      ]);
      setRooms(roomRows);
      setChallenges(challengeRows.challenges);
      setUsers(userRows.users);
      setSettings(queueSettings);
      setRoomState((current) => {
        const next = { ...current };
        for (const room of roomRows) {
          if (!(room.id in next)) next[room.id] = null;
        }
        return next;
      });
      setCreateDraft((draft) => (draft.name ? draft : { ...emptyRoomEditor() }));
      if (!selectedRoomId && roomRows[0]) setSelectedRoomId(roomRows[0].id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load room admin data.");
    } finally {
      setLoading(false);
    }
  }, [canAdmin, selectedRoomId]);

  const loadRoomDetails = useCallback(async (roomId: number) => {
    try {
      const [room, roomAssignments] = await Promise.all([
        getRoom(roomId),
        getRoomAssignments(roomId),
      ]);
      setRoomState((current) => ({ ...current, [roomId]: room.queueState }));
      setAssignments((current) => ({ ...current, [roomId]: roomAssignments }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load room details.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedRoomId) return;
    void loadRoomDetails(selectedRoomId);
  }, [loadRoomDetails, selectedRoomId]);

  useEffect(() => {
    if (!selectedRoom) return;
    setRoomDraft({
      name: selectedRoom.name,
      slug: selectedRoom.slug,
      location: selectedRoom.location ?? "",
      status: selectedRoom.status === "paused" ? "paused" : "active",
    });
    setStateDraft({
      maxInWaitingArea: selectedRoomQueueState?.max_in_waiting_area ?? 0,
      desiredMinutesPerTeam: selectedRoomQueueState?.desired_minutes_per_team ?? 0,
    });
  }, [selectedRoom, selectedRoomQueueState]);

  if (!canAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Queue rooms" />
        <EmptyState
          icon={LockIcon}
          title="You can't access room admin"
          description="Room admin requires the queue:admin capability."
        />
      </div>
    );
  }

  const saveCreate = async () => {
    if (!createDraft.name.trim() || !createDraft.slug.trim()) {
      toast.error("Provide a name and slug.");
      return;
    }
    setSaving("create");
    try {
      await createRoom(
        {
          name: createDraft.name.trim(),
          slug: createDraft.slug.trim(),
          location: createDraft.location.trim() || null,
        },
        crypto.randomUUID(),
      );
      toast.success("Room created.");
      setCreateDraft(emptyRoomEditor());
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create room.");
    } finally {
      setSaving(null);
    }
  };

  const saveSelectedRoom = async () => {
    if (!selectedRoom) return;
    setSaving(`room-${selectedRoom.id}`);
    try {
      await updateRoom(selectedRoom.id, {
        name: roomDraft.name.trim(),
        slug: roomDraft.slug.trim(),
        location: roomDraft.location.trim() || null,
        status: roomDraft.status,
      });
      toast.success("Room updated.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update room.");
    } finally {
      setSaving(null);
    }
  };

  const saveState = async (body: { maxInWaitingArea?: number; desiredMinutesPerTeam?: number }) => {
    if (!selectedRoom) return;
    setSaving(`state-${selectedRoom.id}`);
    try {
      await updateRoomState(selectedRoom.id, body);
      toast.success("Room queue state updated.");
      await loadRoomDetails(selectedRoom.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update queue state.");
    } finally {
      setSaving(null);
    }
  };

  const saveSettings = async () => {
    setSaving("settings");
    try {
      await updateQueueSettings({
        handoff_buffer_minutes: settings.handoff_buffer_minutes,
        schedule_start_at: settings.schedule_start_at,
        schedule_end_at: settings.schedule_end_at,
        pre_call_notification_eta_minutes: settings.pre_call_notification_eta_minutes,
        requeue_prompt_default: settings.requeue_prompt_default,
      });
      toast.success("Queue settings updated.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update settings.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Queue rooms"
        description="Rooms, queue settings and assignment controls for the judging flow."
        actions={
          <Button variant="outline" asChild>
            <Link href="/queue">
              <ArrowLeftIcon className="size-4" />
              Back to panel
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <SectionCard
          title="Rooms"
          description="Create and manage judging rooms."
          icon={Building2Icon}
          bodyClassName="space-y-4"
        >
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              value={createDraft.name}
              onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Room name"
            />
            <Input
              value={createDraft.slug}
              onChange={(e) => setCreateDraft((d) => ({ ...d, slug: e.target.value }))}
              placeholder="Slug"
            />
            <Input
              value={createDraft.location}
              onChange={(e) => setCreateDraft((d) => ({ ...d, location: e.target.value }))}
              placeholder="Location"
            />
            <Button disabled={saving === "create"} onClick={() => void saveCreate()}>
              <PlusIcon className="size-4" />
              Create room
            </Button>
          </div>

          {loading ? (
            <Spinner />
          ) : rooms.length === 0 ? (
            <EmptyState
              icon={Building2Icon}
              title="No rooms configured"
              description="Create the first judging room to start assigning challenges."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  className="rounded-md border p-4 text-left hover:bg-muted/40"
                  onClick={() => setSelectedRoomId(room.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{room.name}</p>
                      <p className="text-muted-foreground text-sm">
                        {room.slug}
                        {room.location ? ` · ${room.location}` : ""}
                      </p>
                    </div>
                    <StatusBadge tone={room.status === "active" ? "success" : "warning"}>
                      {room.status}
                    </StatusBadge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Queue settings"
          description="Global defaults for pacing and reminder windows."
          icon={CalendarClockIcon}
          footer={
            <Button disabled={saving === "settings"} onClick={() => void saveSettings()}>
              Save settings
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="handoff">Handoff buffer minutes</Label>
                <Input
                  id="handoff"
                  type="number"
                  min={0}
                  value={settings.handoff_buffer_minutes}
                  onChange={(e) =>
                    setSettings((current) => ({
                      ...current,
                      handoff_buffer_minutes: Number(e.target.value || 0),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="precall">Pre-call ETA minutes</Label>
                <Input
                  id="precall"
                  type="number"
                  min={0}
                  value={settings.pre_call_notification_eta_minutes}
                  onChange={(e) =>
                    setSettings((current) => ({
                      ...current,
                      pre_call_notification_eta_minutes: Number(e.target.value || 0),
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-start">Schedule start</Label>
                <DateTimeInput
                  value={toDatetimeLocal(settings.schedule_start_at)}
                  onChange={(value) =>
                    setSettings((current) => ({
                      ...current,
                      schedule_start_at: fromDatetimeLocal(value),
                    }))
                  }
                  id="schedule-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-end">Schedule end</Label>
                <DateTimeInput
                  value={toDatetimeLocal(settings.schedule_end_at)}
                  onChange={(value) =>
                    setSettings((current) => ({
                      ...current,
                      schedule_end_at: fromDatetimeLocal(value),
                    }))
                  }
                  id="schedule-end"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="requeue-default">Requeue prompt default</Label>
              <Select
                value={settings.requeue_prompt_default}
                onValueChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    requeue_prompt_default: value as QueueSettings["requeue_prompt_default"],
                  }))
                }
              >
                <SelectTrigger id="requeue-default">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">top</SelectItem>
                  <SelectItem value="bottom">bottom</SelectItem>
                  <SelectItem value="ask">ask</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </SectionCard>
      </div>

      <Modal
        open={selectedRoom !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedRoomId(null);
        }}
        title={selectedRoom?.name ?? "Room"}
        description={selectedRoom?.slug ?? undefined}
        size="xl"
        footer={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={saving === `room-${selectedRoom?.id}`}
              onClick={() => void load()}
            >
              Reset
            </Button>
            <Button
              disabled={saving === `room-${selectedRoom?.id}`}
              onClick={() => void saveSelectedRoom()}
            >
              Save room
            </Button>
          </div>
        }
      >
        {selectedRoom && (
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={roomDraft.name}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input
                  value={roomDraft.slug}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, slug: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label>Location</Label>
                <Input
                  value={roomDraft.location}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, location: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label>Status</Label>
                <Select
                  value={roomDraft.status}
                  onValueChange={(value) =>
                    setRoomDraft((current) => ({
                      ...current,
                      status: value as RoomEditor["status"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">active</SelectItem>
                    <SelectItem value="paused">paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="Room queue state" description="Capacity and pace defaults.">
                <RoomStateEditor
                  roomState={selectedRoomQueueState}
                  draft={stateDraft}
                  onDraftChange={setStateDraft}
                  onSave={saveState}
                  saving={saving === `state-${selectedRoom.id}`}
                />
              </SectionCard>

              <SectionCard title="Assignments" description="Attach challenges and judges by id.">
                <AssignmentsEditor
                  roomId={selectedRoom.id}
                  assignments={selectedRoomAssignments}
                  challengeFallback={selectedChallengeFallback}
                  challenges={challenges}
                  users={users}
                  onAddChallenge={async (challengeId) => {
                    await assignRoomChallenge(selectedRoom.id, challengeId);
                    await loadRoomDetails(selectedRoom.id);
                  }}
                  onAddJudge={async (challengeId, userId) => {
                    await assignRoomJudge(selectedRoom.id, challengeId, userId);
                    await loadRoomDetails(selectedRoom.id);
                  }}
                  onRemoveChallenge={async (challengeId) => {
                    await removeRoomChallenge(selectedRoom.id, challengeId);
                    await loadRoomDetails(selectedRoom.id);
                  }}
                  onRemoveJudge={async (challengeId, userId) => {
                    await removeRoomJudge(selectedRoom.id, challengeId, userId);
                    await loadRoomDetails(selectedRoom.id);
                  }}
                />
              </SectionCard>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="destructive"
                disabled={saving === `room-${selectedRoom.id}`}
                onClick={async () => {
                  try {
                    await deleteRoom(selectedRoom.id);
                    toast.success("Room deleted.");
                    setSelectedRoomId(null);
                    await load();
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : "Could not delete room.");
                  }
                }}
              >
                Delete room
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function RoomStateEditor({
  roomState,
  draft,
  onDraftChange,
  onSave,
  saving,
}: {
  roomState: RoomQueueState | null;
  draft: { maxInWaitingArea: number; desiredMinutesPerTeam: number };
  onDraftChange: React.Dispatch<
    React.SetStateAction<{ maxInWaitingArea: number; desiredMinutesPerTeam: number }>
  >;
  onSave: (body: { maxInWaitingArea?: number; desiredMinutesPerTeam?: number }) => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="max-wait">Waiting area cap</Label>
          <Input
            id="max-wait"
            type="number"
            min={0}
            value={draft.maxInWaitingArea}
            onChange={(e) =>
              onDraftChange((current) => ({
                ...current,
                maxInWaitingArea: Number(e.target.value || 0),
              }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="team-minutes">Minutes per team</Label>
          <Input
            id="team-minutes"
            type="number"
            min={1}
            value={draft.desiredMinutesPerTeam}
            onChange={(e) =>
              onDraftChange((current) => ({
                ...current,
                desiredMinutesPerTeam: Number(e.target.value || 0),
              }))
            }
          />
        </div>
      </div>
      <Button
        disabled={saving}
        onClick={() =>
          onSave({
            maxInWaitingArea: draft.maxInWaitingArea,
            desiredMinutesPerTeam: draft.desiredMinutesPerTeam,
          })
        }
      >
        Save room state
      </Button>
      <p className="text-muted-foreground text-xs">
        Current state: {roomState ? `paused=${String(roomState.is_paused)}` : "not loaded"}
      </p>
    </div>
  );
}

function AssignmentsEditor({
  roomId,
  assignments,
  challengeFallback,
  challenges,
  users,
  onAddChallenge,
  onAddJudge,
  onRemoveChallenge,
  onRemoveJudge,
}: {
  roomId: number;
  assignments: RoomAssignments | null;
  challengeFallback: number;
  challenges: Challenge[];
  users: UserList["users"];
  onAddChallenge: (challengeId: number) => Promise<void>;
  onAddJudge: (challengeId: number, userId: number) => Promise<void>;
  onRemoveChallenge: (challengeId: number) => Promise<void>;
  onRemoveJudge: (challengeId: number, userId: number) => Promise<void>;
}) {
  const [challengeId, setChallengeId] = useState(String(challengeFallback));
  const [judgeChallengeId, setJudgeChallengeId] = useState(String(challengeFallback));
  const [userId, setUserId] = useState("");
  const [removeChallengeId, setRemoveChallengeId] = useState("");
  const [removeJudgeChallengeId, setRemoveJudgeChallengeId] = useState("");
  const [removeJudgeUserId, setRemoveJudgeUserId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setChallengeId(String(challengeFallback));
    setJudgeChallengeId(String(challengeFallback));
  }, [challengeFallback]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Current challenges</p>
          {assignments?.challenges?.length ? (
            <ul className="space-y-2">
              {assignments.challenges.map((assignment) => (
                <li
                  key={`${assignment.challenge_id}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{assignment.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {assignment.assigned_by_email ?? "system"}
                    </p>
                  </div>
                  <StatusBadge tone="brand">id {assignment.challenge_id}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No challenges assigned.</p>
          )}
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Current judges</p>
          {assignments?.judges?.length ? (
            <ul className="space-y-2">
              {assignments.judges.map((assignment) => (
                <li
                  key={`${assignment.challenge_id}:${assignment.user_id}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {assignment.name ?? assignment.email}
                    </p>
                    <p className="text-muted-foreground text-xs">{assignment.title}</p>
                  </div>
                  <StatusBadge tone="info">user {assignment.user_id}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No judges assigned.</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`challenge-${roomId}`}>Attach challenge</Label>
        <div className="flex gap-2">
          <Select value={challengeId} onValueChange={setChallengeId}>
            <SelectTrigger id={`challenge-${roomId}`} className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {challenges.map((challenge) => (
                <SelectItem key={challenge.id} value={String(challenge.id)}>
                  {textForDisplay(challenge.title)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={busy === "challenge"}
            onClick={async () => {
              setBusy("challenge");
              try {
                await onAddChallenge(Number(challengeId));
                toast.success("Challenge attached.");
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Could not attach challenge.");
              } finally {
                setBusy(null);
              }
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`judge-challenge-${roomId}`}>Assign judge</Label>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Select value={judgeChallengeId} onValueChange={setJudgeChallengeId}>
            <SelectTrigger id={`judge-challenge-${roomId}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {challenges.map((challenge) => (
                <SelectItem key={challenge.id} value={String(challenge.id)}>
                  {textForDisplay(challenge.title)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="User" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={String(user.id)}>
                  {user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={busy === "judge" || !userId}
            onClick={async () => {
              setBusy("judge");
              try {
                await onAddJudge(Number(judgeChallengeId), Number(userId));
                toast.success("Judge assigned.");
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Could not assign judge.");
              } finally {
                setBusy(null);
              }
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">Remove by id</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={removeChallengeId}
            onChange={(e) => setRemoveChallengeId(e.target.value)}
            placeholder="Challenge id"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={removeJudgeChallengeId}
              onChange={(e) => setRemoveJudgeChallengeId(e.target.value)}
              placeholder="Judge challenge id"
            />
            <Input
              value={removeJudgeUserId}
              onChange={(e) => setRemoveJudgeUserId(e.target.value)}
              placeholder="User id"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              disabled={busy === "remove-challenge" || !removeChallengeId}
              onClick={async () => {
                setBusy("remove-challenge");
                try {
                  await onRemoveChallenge(Number(removeChallengeId));
                  toast.success("Challenge removed.");
                } catch (err) {
                  toast.error(
                    err instanceof ApiError ? err.message : "Could not remove challenge.",
                  );
                } finally {
                  setBusy(null);
                }
              }}
            >
              Remove challenge
            </Button>
            <Button
              variant="outline"
              disabled={busy === "remove-judge" || !removeJudgeChallengeId || !removeJudgeUserId}
              onClick={async () => {
                setBusy("remove-judge");
                try {
                  await onRemoveJudge(Number(removeJudgeChallengeId), Number(removeJudgeUserId));
                  toast.success("Judge removed.");
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : "Could not remove judge.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Remove judge
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
