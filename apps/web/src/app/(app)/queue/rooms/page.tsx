"use client";

// Queue admin surface for rooms and assignments (H29, H46).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { Button } from "@/components/ui/button";
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
import { toast } from "@/lib/toast";
import type { EnterpriseSummary } from "@/lib/types";
import { RoomFormPanel, type RoomFormValues } from "./room-form-panel";
import { type RoomPatch, RoomsTable } from "./rooms-table";

export default function QueueRoomsPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLocale();
  const router = useRouter();
  useEffect(() => {
    if (!embedded && new URLSearchParams(window.location.search).get("tab") === "window") {
      router.replace("/settings/event?tab=judging");
    }
  }, [embedded, router]);
  const { can } = useSessionContext();
  const canAdmin = can(CAPABILITIES.QUEUE_ADMIN);
  const tab = "rooms";
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<Record<number, RoomAssignments | null>>({});
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [roomDetailsError, setRoomDetailsError] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"create" | "edit" | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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
    if (!hasLoadedRef.current) setLoading(true);
    setLoadError(null);
    try {
      const [roomRows, enterpriseRows] = await Promise.all([listRooms(), listEnterprises()]);
      hasLoadedRef.current = true;
      setRooms(roomRows);
      setEnterprises(enterpriseRows);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setLoadError(null);
        setRooms([]);
      } else {
        const message = err instanceof ApiError ? err.message : t("couldNotLoadRoomAdminData");
        setLoadError(message);
        toast.error(message, t("rooms"));
      }
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
        toast.error(message, t("rooms"));
      }
    },
    [t],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (panelMode !== "edit" || selectedRoomId === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoomDetails(selectedRoomId);
  }, [loadRoomDetails, panelMode, selectedRoomId]);

  // A live refresh should never reset the editor's in-progress name/location.
  const editingRef = useRef(false);
  useEffect(() => {
    editingRef.current = panelMode === "edit";
  }, [panelMode]);

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
  }, [liveRefresh, load]);

  const openCreatePanel = () => {
    setDraftOpen(false);
    setSelectedRoomId(null);
    setRoomDetailsError(null);
    setPanelMode("create");
  };

  const openEditPanel = (roomId: number) => {
    setSelectedRoomId(roomId);
    setRoomDetailsError(null);
    setPanelMode("edit");
  };

  const closePanel = () => {
    setPanelMode(null);
    setSelectedRoomId(null);
    setRoomDetailsError(null);
  };

  const saveInlineRoom = useCallback(
    async (room: Room, patch: RoomPatch): Promise<boolean> => {
      if (patch.name !== undefined && !patch.name.trim()) {
        toast.error(t("roomNameRequired"), t("saveRoom"));
        return false;
      }
      try {
        const updated = await updateRoom(room.id, patch);
        setRooms((current) =>
          current.map((currentRoom) =>
            currentRoom.id === room.id ? { ...currentRoom, ...updated } : currentRoom,
          ),
        );
        return true;
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateRoom"), t("saveRoom"));
        return false;
      }
    },
    [t],
  );

  const createRoomFromDraft = async (name: string, location: string) => {
    setDraftSaving(true);
    try {
      const created = await createRoom({ name, location: location || null }, crypto.randomUUID());
      toast.success(t("roomCreated"), { compactTitle: t("createRoom") });
      setDraftOpen(false);
      await load();
      setSelectedRoomId(created.id);
      setPanelMode("edit");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateRoom"), t("createRoom"));
    } finally {
      setDraftSaving(false);
    }
  };

  const submitRoomPanel = async (values: RoomFormValues) => {
    if (panelMode === "create") {
      const created = await createRoom(
        { name: values.name, location: values.location || null },
        crypto.randomUUID(),
      );
      let assignmentError: string | null = null;
      if (values.enterpriseId) {
        try {
          await assignRoomEnterprise(created.id, Number(values.enterpriseId), crypto.randomUUID());
        } catch (err) {
          assignmentError = err instanceof ApiError ? err.message : t("couldNotAssignEnterprise");
        }
      }
      toast.success(t("roomCreated"), { compactTitle: t("createRoom") });
      closePanel();
      await load();
      if (assignmentError) toast.error(assignmentError, t("toastAssignCompany"));
      return;
    }

    if (!selectedRoom) return;
    const updated = await updateRoom(selectedRoom.id, {
      name: values.name,
      location: values.location || null,
    });
    setRooms((current) =>
      current.map((room) => (room.id === selectedRoom.id ? { ...room, ...updated } : room)),
    );
    toast.success(t("roomUpdated"), { compactTitle: t("saveRoom") });
    closePanel();
  };

  const assignEnterprise = async (room: Room, enterpriseId: number | null) => {
    if (enterpriseId === null) await removeRoomEnterprise(room.id);
    else await assignRoomEnterprise(room.id, enterpriseId, crypto.randomUUID());
    const enterprise = enterprises.find((item) => item.id === enterpriseId);
    setRooms((current) =>
      current.map((item) =>
        item.id === room.id
          ? { ...item, enterprise_id: enterpriseId, enterprise_name: enterprise?.name ?? null }
          : item,
      ),
    );
    setAssignments((current) => ({ ...current, [room.id]: null }));
    if (selectedRoomId === room.id) await loadRoomDetails(room.id);
  };

  const setRoomEnterprise = async (enterpriseId: number) => {
    if (selectedRoom) await assignEnterprise(selectedRoom, enterpriseId);
  };

  const clearRoomEnterprise = async () => {
    if (selectedRoom) await assignEnterprise(selectedRoom, null);
  };

  const removeSelectedRoom = async () => {
    if (!selectedRoom) return;
    await deleteRoom(selectedRoom.id);
    setRooms((current) => current.filter((room) => room.id !== selectedRoom.id));
    setAssignments((current) => {
      const next = { ...current };
      delete next[selectedRoom.id];
      return next;
    });
    closePanel();
    toast.success(t("roomDeleted"), { compactTitle: t("deleteRoom") });
  };

  const filteredRooms = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rooms.filter((room) => {
      const matchesStatus = statusFilter === "all" || room.status === statusFilter;
      const matchesQuery =
        !normalizedQuery ||
        `${room.name} ${room.location ?? ""} ${room.enterprise_name ?? ""} ${room.id}`
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesStatus && matchesQuery;
    });
  }, [query, rooms, statusFilter]);

  const hasFilters = Boolean(query.trim()) || statusFilter !== "all";
  const emptyAction = hasFilters ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        setQuery("");
        setStatusFilter("all");
      }}
    >
      {t("clearFilters")}
    </Button>
  ) : (
    <Button size="sm" onClick={openCreatePanel}>
      <PlusIcon className="size-4" aria-hidden="true" />
      {t("createRoom")}
    </Button>
  );

  if (!canAdmin) return <AccessDenied ask={t("roomAdminDeniedDesc")} />;

  return (
    <PageLayout width="workspace">
      {!embedded && <PageHeader title={t("roomConfigurationTitle")} />}

      {tab === "rooms" && (
        <div className="space-y-4">
          <ListToolbar
            search={{
              id: "room-search",
              label: t("filterRooms"),
              placeholder: t("filterRoomsPlaceholder"),
              value: query,
              onValueChange: setQuery,
            }}
            filters={[
              {
                id: "status",
                label: t("statusColumn"),
                icon: PauseIcon,
                type: "single",
                value: statusFilter,
                resetValue: "all",
                onChange: setStatusFilter,
                options: [
                  { value: "all", label: t("allRoomStatuses") },
                  { value: "active", label: t("roomStatusActive") },
                  { value: "paused", label: t("roomStatusPaused") },
                ],
              },
            ]}
          />

          <RoomsTable
            rooms={filteredRooms}
            enterprises={enterprises}
            onAssignEnterprise={assignEnterprise}
            loading={loading && !hasLoadedRef.current}
            error={loadError}
            onRetry={() => void load()}
            emptyTitle={hasFilters ? t("noMatchingRooms") : t("noRoomsConfigured")}
            emptyAction={emptyAction}
            draftOpen={draftOpen}
            draftSaving={draftSaving}
            onDraftOpen={() => setDraftOpen(true)}
            onDraftCancel={() => setDraftOpen(false)}
            onDraftCreate={(name, location) => void createRoomFromDraft(name, location)}
            onSave={saveInlineRoom}
            onOpenEdit={openEditPanel}
          />
        </div>
      )}

      {tab === "rooms" && (loading || loadError || rooms.length > 0) && (
        <div className="pointer-events-none sticky bottom-6 z-20 flex h-0 items-end justify-end">
          <Button className="pointer-events-auto shadow-floating" onClick={openCreatePanel}>
            <PlusIcon className="size-4" aria-hidden="true" />
            {t("createRoom")}
          </Button>
        </div>
      )}

      {panelMode && (
        <RoomFormPanel
          open
          mode={panelMode}
          room={selectedRoom}
          assignments={selectedRoomAssignments}
          enterprises={enterprises}
          detailsError={roomDetailsError}
          onRetryDetails={() => {
            if (selectedRoom) void loadRoomDetails(selectedRoom.id);
          }}
          onOpenChange={(open) => {
            if (!open) closePanel();
          }}
          onSubmit={submitRoomPanel}
          onDelete={removeSelectedRoom}
          onSetEnterprise={setRoomEnterprise}
          onClearEnterprise={clearRoomEnterprise}
        />
      )}
    </PageLayout>
  );
}
