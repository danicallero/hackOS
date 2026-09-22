"use client";

// Queue admin surface for rooms and assignments (H29, H46).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { TabBar } from "@/components/common/tab-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  assignRoomEnterprise,
  createRoom,
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
import { useUrlTab } from "@/lib/url-tab";
import { JudgingWindowTab } from "./judging-window-tab";
import { RoomFormPanel, type RoomFormValues } from "./room-form-panel";
import { type RoomPatch, RoomsTable } from "./rooms-table";

const JUDGING_SETTINGS_TABS = ["rooms", "window"] as const;
type JudgingSettingsTab = (typeof JUDGING_SETTINGS_TABS)[number];

export default function QueueRoomsPage() {
  const { t } = useLocale();
  const { can } = useSessionContext();
  const canAdmin = can(CAPABILITIES.QUEUE_ADMIN);
  const { tab, setTab } = useUrlTab<JudgingSettingsTab>({
    values: JUDGING_SETTINGS_TABS,
    defaultValue: "rooms",
  });
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
        toast.error(message);
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
        toast.error(message);
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
        toast.error(t("roomNameRequired"));
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
        toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateRoom"));
        return false;
      }
    },
    [t],
  );

  const createRoomFromDraft = async (name: string, location: string) => {
    setDraftSaving(true);
    try {
      const created = await createRoom({ name, location: location || null }, crypto.randomUUID());
      toast.success(t("roomCreated"));
      setDraftOpen(false);
      await load();
      setSelectedRoomId(created.id);
      setPanelMode("edit");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateRoom"));
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
      toast.success(t("roomCreated"));
      closePanel();
      await load();
      if (assignmentError) toast.error(assignmentError);
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
    toast.success(t("roomUpdated"));
    closePanel();
  };

  const setRoomEnterprise = async (enterpriseId: number) => {
    if (!selectedRoom) return;
    await assignRoomEnterprise(selectedRoom.id, enterpriseId, crypto.randomUUID());
    const enterprise = enterprises.find((item) => item.id === enterpriseId);
    setRooms((current) =>
      current.map((room) =>
        room.id === selectedRoom.id
          ? { ...room, enterprise_id: enterpriseId, enterprise_name: enterprise?.name ?? null }
          : room,
      ),
    );
    await loadRoomDetails(selectedRoom.id);
  };

  const clearRoomEnterprise = async () => {
    if (!selectedRoom) return;
    await removeRoomEnterprise(selectedRoom.id);
    setRooms((current) =>
      current.map((room) =>
        room.id === selectedRoom.id
          ? { ...room, enterprise_id: null, enterprise_name: null }
          : room,
      ),
    );
    await loadRoomDetails(selectedRoom.id);
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
    <div className="flex flex-wrap justify-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setDraftOpen(true)}>
        <PlusIcon className="size-4" aria-hidden="true" />
        {t("addRoomHere")}
      </Button>
      <Button size="sm" onClick={openCreatePanel}>
        <PlusIcon className="size-4" aria-hidden="true" />
        {t("createRoom")}
      </Button>
    </div>
  );

  if (!canAdmin) return <AccessDenied ask={t("roomAdminDeniedDesc")} />;

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("judgingSettingsTitle")} />

      <Tabs value={tab} onValueChange={(value) => setTab(value)}>
        <TabBar aria-label={t("judgingSettingsTitle")} className="w-full justify-start">
          <TabsTrigger value="rooms">{t("rooms")}</TabsTrigger>
          <TabsTrigger value="window">{t("judgingWindowTitle")}</TabsTrigger>
        </TabBar>
      </Tabs>

      {tab === "rooms" && (
        <Surface padding="none" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-end gap-2 border-b p-4">
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <SearchIcon
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("filterRoomsPlaceholder")}
                  aria-label={t("filterRooms")}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" aria-label={t("statusColumn")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allRoomStatuses")}</SelectItem>
                  <SelectItem value="active">{t("roomStatusActive")}</SelectItem>
                  <SelectItem value="paused">{t("roomStatusPaused")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <RoomsTable
            rooms={filteredRooms}
            loading={loading && !hasLoadedRef.current}
            error={loadError}
            onRetry={() => void load()}
            emptyTitle={hasFilters ? t("noMatchingRooms") : t("noRoomsConfigured")}
            emptyDescription={hasFilters ? undefined : t("noRoomsConfiguredDesc")}
            emptyAction={emptyAction}
            draftOpen={draftOpen}
            draftSaving={draftSaving}
            onDraftOpen={() => setDraftOpen(true)}
            onDraftCancel={() => setDraftOpen(false)}
            onDraftCreate={(name, location) => void createRoomFromDraft(name, location)}
            onSave={saveInlineRoom}
            onOpenEdit={openEditPanel}
          />
        </Surface>
      )}

      {tab === "window" && <JudgingWindowTab />}

      {tab === "rooms" && (
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
          onSetEnterprise={setRoomEnterprise}
          onClearEnterprise={clearRoomEnterprise}
        />
      )}
    </div>
  );
}
