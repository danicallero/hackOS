"use client";

// The room administration grid (H29, H46): the small, high-frequency fields
// stay editable in place while enterprise routing remains in the room editor.

import { Building2Icon, PencilIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import {
  commitAndNavigateEditableTableCell,
  editableTableEditingNavigationDirection,
  editableTableNavigationDirection,
  handleEditableTableGridKeyDown,
  refocusEditableTableCell,
} from "@/components/common/editable-table-grid";
import { EmptyState } from "@/components/common/empty-state";
import { IconButton } from "@/components/common/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/lib/i18n";
import type { Room } from "@/lib/queue";
import { cn } from "@/lib/utils";

const GRID_PREFIX = "room";

export type RoomPatch = { name?: string; location?: string | null };

function roomCellProps(roomId: number, column: string) {
  return {
    "data-room-cell": "true",
    "data-room-row": String(roomId),
    "data-room-column": column,
  } as const;
}

function roomFieldAria(t: ReturnType<typeof useLocale>["t"], field: string, value: string): string {
  return t("editTableFieldAria", { field, value: value || t("emptyValue") });
}

function EditableRoomTextCell({
  fieldLabel,
  value,
  placeholder,
  onSave,
}: {
  fieldLabel: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => Promise<boolean>;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit(nextDraft = draft): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    try {
      const saved = await onSave(nextDraft);
      if (saved) setEditing(false);
      return saved;
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        onKeyDown={(event) =>
          handleEditableTableGridKeyDown(event, GRID_PREFIX, editableTableNavigationDirection)
        }
        data-room-focusable="true"
        data-room-activate="true"
        aria-label={roomFieldAria(t, fieldLabel, value)}
        className="hover:bg-muted -mx-1 block w-full truncate rounded px-1 py-0.5 text-left"
      >
        {value || <span className="text-muted-foreground">{placeholder ?? "—"}</span>}
      </button>
    );
  }

  return (
    <div
      className="bg-popover border-border absolute inset-y-0 left-0 z-20 flex items-center rounded-md border shadow-md"
      style={{ width: "max(100%, 12rem)" }}
    >
      <Input
        size="sm"
        ref={inputRef}
        value={draft}
        disabled={saving}
        data-room-focusable="true"
        aria-label={t("editTableFieldAria", { field: fieldLabel, value: draft || t("emptyValue") })}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => void commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (editableTableEditingNavigationDirection(event)) {
            void commitAndNavigateEditableTableCell(
              event,
              GRID_PREFIX,
              () => commit(event.currentTarget.value),
              editableTableEditingNavigationDirection,
            );
            return;
          }
          const input = event.currentTarget;
          if (event.key === "Enter") {
            event.preventDefault();
            void commit(input.value).then(() => refocusEditableTableCell(input, GRID_PREFIX));
          } else if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
            refocusEditableTableCell(input, GRID_PREFIX);
          }
        }}
        className="w-full border-0 bg-transparent text-sm shadow-none"
      />
    </div>
  );
}

export function DraftRoomRow({
  saving,
  onCancel,
  onCreate,
}: {
  saving: boolean;
  onCancel: () => void;
  onCreate: (name: string, location: string) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const trimmedName = name.trim();

  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={5} className="py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            autoFocus
            value={name}
            aria-label={t("newRoomNameLabel")}
            placeholder={t("newRoomNamePlaceholder")}
            className="w-full max-w-xs"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && trimmedName && !saving) {
                event.preventDefault();
                onCreate(trimmedName, location.trim());
              }
              if (event.key === "Escape") onCancel();
            }}
          />
          <Input
            size="sm"
            value={location}
            aria-label={t("locationLabel")}
            placeholder={t("locationLabel")}
            className="w-full max-w-xs"
            onChange={(event) => setLocation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && trimmedName && !saving) {
                event.preventDefault();
                onCreate(trimmedName, location.trim());
              }
              if (event.key === "Escape") onCancel();
            }}
          />
          <Button
            size="sm"
            disabled={saving || !trimmedName}
            onClick={() => onCreate(trimmedName, location.trim())}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
            {t("addAction")}
          </Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function RoomsTable({
  rooms,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyAction,
  draftOpen,
  draftSaving,
  onDraftOpen,
  onDraftCancel,
  onDraftCreate,
  onSave,
  onOpenEdit,
}: {
  rooms: Room[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction: React.ReactNode;
  draftOpen: boolean;
  draftSaving: boolean;
  onDraftOpen: () => void;
  onDraftCancel: () => void;
  onDraftCreate: (name: string, location: string) => void;
  onSave: (room: Room, patch: RoomPatch) => Promise<boolean>;
  onOpenEdit: (roomId: number) => void;
}) {
  const { t } = useLocale();

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[680px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("columnRoom")}</TableHead>
            <TableHead>{t("locationLabel")}</TableHead>
            <TableHead>{t("roomEnterpriseColumn")}</TableHead>
            <TableHead>{t("statusColumn")}</TableHead>
            <TableHead className="w-12 text-right">
              <span className="sr-only">{t("actionsColumn")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {error ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="p-4">
                <ContextualError message={error} onRetry={onRetry} />
              </TableCell>
            </TableRow>
          ) : loading ? (
            Array.from({ length: 5 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder rows.
              <TableRow key={index} className="hover:bg-transparent">
                {Array.from({ length: 5 }, (_, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder cells.
                  <TableCell key={cellIndex}>
                    <Skeleton className="h-4 w-full max-w-40" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rooms.length === 0 && !draftOpen ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="p-0">
                <EmptyState
                  icon={Building2Icon}
                  title={emptyTitle}
                  description={emptyDescription}
                  action={emptyAction}
                />
              </TableCell>
            </TableRow>
          ) : (
            <>
              {rooms.map((room) => (
                <TableRow key={room.id}>
                  <TableCell className="relative" {...roomCellProps(room.id, "name")}>
                    <EditableRoomTextCell
                      fieldLabel={t("columnRoom")}
                      value={room.name}
                      onSave={async (name) => onSave(room, { name: name.trim() })}
                    />
                  </TableCell>
                  <TableCell className="relative" {...roomCellProps(room.id, "location")}>
                    <EditableRoomTextCell
                      fieldLabel={t("locationLabel")}
                      value={room.location ?? ""}
                      placeholder={t("noLocationSet")}
                      onSave={async (location) =>
                        onSave(room, { location: location.trim() || null })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => onOpenEdit(room.id)}
                      className="hover:bg-muted -mx-1 block max-w-56 truncate rounded px-1 py-0.5 text-left"
                      aria-label={t("editRoomAssignmentsAria", { room: room.name })}
                    >
                      {room.enterprise_name ?? (
                        <span className="text-muted-foreground">{t("noEnterpriseAssigned")}</span>
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          room.status === "active" ? "bg-success" : "bg-warning",
                        )}
                        aria-hidden="true"
                      />
                      {room.status === "active" ? t("roomStatusActive") : t("roomStatusPaused")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      label={t("editRoomAria", { room: room.name })}
                      onClick={() => onOpenEdit(room.id)}
                    >
                      <PencilIcon className="size-3.5" aria-hidden="true" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {draftOpen && (
                <DraftRoomRow
                  saving={draftSaving}
                  onCancel={onDraftCancel}
                  onCreate={onDraftCreate}
                />
              )}
            </>
          )}
          {!loading && !error && rooms.length > 0 && !draftOpen && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="border-t border-dashed py-2 text-center">
                <Button variant="ghost" size="sm" onClick={onDraftOpen}>
                  <PlusIcon className="size-3.5" aria-hidden="true" />
                  {t("addRoomHere")}
                </Button>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
