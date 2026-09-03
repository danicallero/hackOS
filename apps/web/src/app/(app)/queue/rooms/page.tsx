"use client";

// Queue admin surface for rooms and assignments (H46).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { Building2Icon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
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
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  assignRoomEnterprise,
  createRoom,
  deleteRoom,
  getRoomAssignments,
  listEnterprises,
  listRooms,
  type Room,
  type RoomAssignments,
  removeRoomEnterprise,
  updateRoom,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import type { EnterpriseSummary } from "@/lib/types";
import { AssignmentsEditor } from "./room-panels";

type RoomEditor = {
  name: string;
  slug: string;
  location: string;
};

function emptyRoomEditor(): RoomEditor {
  return { name: "", slug: "", location: "" };
}

export default function QueueRoomsPage() {
  const { t } = useLocale();
  const { can } = useSessionContext();
  // Admin-only (H46): a sponsor rep manages their queue group's challenges
  // and judges from the enterprise workspace, but never which rooms serve
  // it or a room's own settings.
  const canAdmin = can(CAPABILITIES.QUEUE_ADMIN);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<Record<number, RoomAssignments | null>>({});
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [roomDetailsError, setRoomDetailsError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [createDraft, setCreateDraft] = useState<RoomEditor>(emptyRoomEditor());
  const [roomDraft, setRoomDraft] = useState<RoomEditor>(emptyRoomEditor());
  const [saving, setSaving] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );
  const selectedRoomAssignments = selectedRoom ? (assignments[selectedRoom.id] ?? null) : null;

  const load = useCallback(async () => {
    if (!canAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [roomRows, enterpriseRows] = await Promise.all([listRooms(), listEnterprises()]);
      setRooms(roomRows);
      setEnterprises(enterpriseRows);
      setCreateDraft((draft) => (draft.name ? draft : { ...emptyRoomEditor() }));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadRoomAdminData");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [canAdmin, t]);

  const loadRoomDetails = useCallback(
    async (roomId: number) => {
      setRoomDetailsError(null);
      try {
        const roomAssignments = await getRoomAssignments(roomId);
        setAssignments((current) => ({ ...current, [roomId]: roomAssignments }));
      } catch (err) {
        const message = err instanceof ApiError ? err.message : t("couldNotLoadRoomDetails");
        setRoomDetailsError(message);
        toast.error(message);
      }
    },
    [t],
  );

  const openCreateModal = () => {
    setSelectedRoomId(null);
    setCreateDraft(emptyRoomEditor());
    setModalMode("create");
  };

  const openManageModal = (roomId: number) => {
    setSelectedRoomId(roomId);
    setRoomDetailsError(null);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedRoomId(null);
    setRoomDetailsError(null);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedRoomId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoomDetails(selectedRoomId);
  }, [loadRoomDetails, selectedRoomId]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // edits rooms/assignments elsewhere — but never while the room editor
  // modal is open, since `load` recomputing `selectedRoom` would reseed
  // `roomDraft` (name/slug/location) and discard an in-progress edit.
  const editingRef = useRef(false);
  useEffect(() => {
    editingRef.current = modalMode === "edit";
  }, [modalMode]);

  const liveRefresh = useAutoRefresh("/api/queue/stream", [
    EVENTS.QUEUE_ENTRY_CHANGED,
    EVENTS.QUEUE_ROOM_CHANGED,
  ]);
  const isFirstLiveRefresh = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (isFirstLiveRefresh.current) {
      isFirstLiveRefresh.current = false;
      return;
    }
    if (editingRef.current) return;
    void load();
    if (selectedRoomId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadRoomDetails(selectedRoomId);
    }
  }, [liveRefresh, load, loadRoomDetails, selectedRoomId]);

  useEffect(() => {
    if (!selectedRoom) return;
    // Sync editable draft form to the currently-selected room; resets any unsaved edits when selection changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoomDraft({
      name: selectedRoom.name,
      slug: selectedRoom.slug,
      location: selectedRoom.location ?? "",
    });
  }, [selectedRoom]);

  const roomStatusLabel = (status: string) =>
    status === "active"
      ? t("roomStatusActive")
      : status === "paused"
        ? t("roomStatusPaused")
        : status;

  const filteredRooms = useMemo(
    () => (statusFilter === "all" ? rooms : rooms.filter((room) => room.status === statusFilter)),
    [rooms, statusFilter],
  );
  const activeCount = useMemo(
    () => rooms.filter((room) => room.status === "active").length,
    [rooms],
  );

  const roomColumns: Column<Room>[] = [
    {
      id: "room",
      header: t("columnRoom"),
      sortValue: (room) => room.name.toLowerCase(),
      cell: (room) => (
        <div>
          <p className="font-medium">{room.name}</p>
          <p className="text-muted-foreground text-sm">{room.slug}</p>
        </div>
      ),
    },
    {
      id: "location",
      header: t("locationLabel"),
      sortValue: (room) => (room.location ?? "").toLowerCase(),
      cell: (room) =>
        room.location ? (
          <span>{room.location}</span>
        ) : (
          <span className="text-muted-foreground">{t("noLocationSet")}</span>
        ),
    },
    {
      id: "status",
      header: t("statusColumn"),
      sortValue: (room) => room.status,
      cell: (room) => (
        <StatusBadge tone={room.status === "active" ? "success" : "warning"}>
          {roomStatusLabel(room.status)}
        </StatusBadge>
      ),
    },
  ];

  if (!canAdmin) {
    return <AccessDenied ask={t("roomAdminDeniedDesc")} />;
  }

  const saveCreate = async () => {
    if (!createDraft.name.trim() || !createDraft.slug.trim()) {
      toast.error(t("provideNameAndSlug"));
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
      toast.success(t("roomCreated"));
      setCreateDraft(emptyRoomEditor());
      closeModal();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateRoom"));
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
      });
      toast.success(t("roomUpdated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateRoom"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("rooms")}
        actions={
          <Button onClick={openCreateModal}>
            <PlusIcon className="size-4" />
            {t("createRoom")}
          </Button>
        }
      />

      <SectionCard
        title={t("roomQueues")}
        description={
          !loading && !loadError && rooms.length > 0
            ? t("roomsSummary", { active: activeCount, total: rooms.length })
            : undefined
        }
        icon={Building2Icon}
        bodyClassName="space-y-4"
      >
        {!loading && !loadError && rooms.length === 0 ? (
          <EmptyState
            icon={Building2Icon}
            title={t("noRoomsConfigured")}
            description={t("noRoomsConfiguredDesc")}
          />
        ) : (
          <DataTable
            columns={roomColumns}
            data={filteredRooms}
            getRowId={(room) => String(room.id)}
            onRowClick={(room) => openManageModal(room.id)}
            getRowLabel={(room) => room.name}
            loading={loading}
            error={loadError ? { message: loadError, onRetry: load } : undefined}
            searchable={(room) => `${room.name} ${room.slug} ${room.location ?? ""}`}
            searchPlaceholder={t("filterRoomsPlaceholder")}
            searchLabel={t("filterRooms")}
            pageSize={10}
            toolbar={
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allRoomStatuses")}</SelectItem>
                  <SelectItem value="active">{t("roomStatusActive")}</SelectItem>
                  <SelectItem value="paused">{t("roomStatusPaused")}</SelectItem>
                </SelectContent>
              </Select>
            }
            filteredEmpty={{
              active: statusFilter !== "all",
              onClear: () => setStatusFilter("all"),
              title: t("noMatchingRooms"),
            }}
            empty={{
              icon: Building2Icon,
              title: t("noRoomsConfigured"),
              description: t("noRoomsConfiguredDesc"),
            }}
          />
        )}
      </SectionCard>

      <Modal
        open={modalMode !== null}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        title={modalMode === "create" ? t("createRoom") : (selectedRoom?.name ?? t("roomFallback"))}
        description={modalMode === "create" ? undefined : (selectedRoom?.slug ?? undefined)}
        size="xl"
        footer={
          modalMode === "create" ? (
            <>
              <Button variant="outline" onClick={closeModal}>
                {t("cancel")}
              </Button>
              <Button disabled={saving === "create"} onClick={() => void saveCreate()}>
                {t("createRoom")}
              </Button>
            </>
          ) : (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <AlertModal
                title={t("deleteRoomConfirmTitle")}
                description={t("deleteRoomConfirmDesc")}
                cancelLabel={t("cancel")}
                confirmLabel={t("deleteRoom")}
                destructive
                pending={saving === `room-${selectedRoom?.id}`}
                trigger={
                  <Button variant="destructive" disabled={saving === `room-${selectedRoom?.id}`}>
                    {t("deleteRoom")}
                  </Button>
                }
                onConfirm={async () => {
                  if (!selectedRoom) return;
                  setSaving(`room-${selectedRoom.id}`);
                  try {
                    await deleteRoom(selectedRoom.id);
                    toast.success(t("roomDeleted"));
                    closeModal();
                    await load();
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteRoom"));
                  } finally {
                    setSaving(null);
                  }
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={saving === `room-${selectedRoom?.id}`}
                  onClick={closeModal}
                >
                  {t("cancel")}
                </Button>
                <Button
                  disabled={saving === `room-${selectedRoom?.id}`}
                  onClick={() => void saveSelectedRoom()}
                >
                  {t("saveRoom")}
                </Button>
              </div>
            </div>
          )
        }
      >
        {modalMode === "create" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="room-create-name">{t("name")}</Label>
              <Input
                id="room-create-name"
                value={createDraft.name}
                onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room-create-slug">{t("slugLabel")}</Label>
              <Input
                id="room-create-slug"
                value={createDraft.slug}
                onChange={(e) => setCreateDraft((d) => ({ ...d, slug: e.target.value }))}
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="room-create-location">{t("locationLabel")}</Label>
              <Input
                id="room-create-location"
                value={createDraft.location}
                onChange={(e) => setCreateDraft((d) => ({ ...d, location: e.target.value }))}
              />
            </div>
          </div>
        )}
        {modalMode === "edit" && selectedRoom && (
          <div className="space-y-5">
            {roomDetailsError && (
              <ContextualError
                message={roomDetailsError}
                onRetry={() => void loadRoomDetails(selectedRoom.id)}
              />
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`room-${selectedRoom.id}-name`}>{t("name")}</Label>
                <Input
                  id={`room-${selectedRoom.id}-name`}
                  value={roomDraft.name}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`room-${selectedRoom.id}-slug`}>{t("slugLabel")}</Label>
                <Input
                  id={`room-${selectedRoom.id}-slug`}
                  value={roomDraft.slug}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, slug: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor={`room-${selectedRoom.id}-location`}>{t("locationLabel")}</Label>
                <Input
                  id={`room-${selectedRoom.id}-location`}
                  value={roomDraft.location}
                  onChange={(e) =>
                    setRoomDraft((current) => ({ ...current, location: e.target.value }))
                  }
                />
              </div>
            </div>
            <SectionCard title={t("assignments")}>
              <AssignmentsEditor
                roomId={selectedRoom.id}
                assignments={selectedRoomAssignments}
                enterprises={enterprises}
                onSetEnterprise={async (enterpriseId) => {
                  await assignRoomEnterprise(selectedRoom.id, enterpriseId, crypto.randomUUID());
                  await loadRoomDetails(selectedRoom.id);
                }}
                onClearEnterprise={async () => {
                  await removeRoomEnterprise(selectedRoom.id);
                  await loadRoomDetails(selectedRoom.id);
                }}
              />
            </SectionCard>
          </div>
        )}
      </Modal>
    </div>
  );
}
