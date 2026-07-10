"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  CalendarDaysIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { ScheduledDateTimeField } from "@/components/common/scheduled-datetime-field";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { formatScheduledDateTime } from "@/lib/datetime";
import { logisticsApi, type PublicScheduleItem, type ScheduleInput } from "@/lib/logistics";
import { useCan } from "@/lib/session";

const EMPTY_FORM: ScheduleInput = {
  title: "",
  description: "",
  location: "",
  type: "activity",
  requiresScan: false,
  startsAt: "",
  endsAt: "",
  visibility: "hidden",
  publishAt: null,
};

const TYPE_OPTIONS = ["activity", "meal", "workshop", "talk", "ceremony", "other"];

function toForm(item: PublicScheduleItem): ScheduleInput {
  return {
    title: item.title,
    description: item.description ?? "",
    location: item.location ?? "",
    type: item.type ?? "activity",
    requiresScan: item.requiresScan ?? false,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    visibility: item.visibility ?? "hidden",
    publishAt: item.publishAt,
  };
}

function cleanForm(form: ScheduleInput): ScheduleInput {
  return {
    title: form.title.trim(),
    description: form.description?.trim() || null,
    location: form.location?.trim() || null,
    type: form.type?.trim() || null,
    requiresScan: form.type === "meal" || form.requiresScan === true,
    startsAt: new Date(form.startsAt).toISOString(),
    endsAt: new Date(form.endsAt).toISOString(),
    visibility: form.visibility,
    publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : null,
  };
}

function visibilityTone(visibility: string | undefined) {
  return visibility === "shown" ? "success" : "neutral";
}

export default function SchedulePage() {
  const canManage = useCan(CAPABILITIES.SCHEDULE_MANAGE);
  const [items, setItems] = useState<PublicScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PublicScheduleItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await logisticsApi.schedule();
      setItems(result.items);
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load schedule.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Soft, in-place refresh instead of a hard reload when another admin
  // edits the schedule elsewhere (H47).
  const liveRefresh = useAutoRefresh("/api/content/stream", [EVENTS.CONTENT_SCHEDULE_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (canManage) void load();
    else setLoading(false);
  }, [canManage, load, liveRefresh]);

  async function setVisibility(visibility: "shown" | "hidden") {
    const ids = [...selectedIds].map(Number);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await logisticsApi.setScheduleVisibility(ids, visibility);
      toast.success(visibility === "shown" ? "Items shown." : "Items hidden.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update visibility.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: PublicScheduleItem) {
    setBusy(true);
    try {
      await logisticsApi.deleteSchedule(item.id);
      toast.success("Schedule item deleted.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete schedule item.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title="Schedule" />
        <EmptyState
          icon={LockIcon}
          title="You can't manage the schedule"
          description="The schedule page requires schedule:manage."
        />
      </div>
    );
  }

  const columns: Column<PublicScheduleItem>[] = [
    {
      id: "title",
      header: "Item",
      sortValue: (item) => item.title,
      cell: (item) => (
        <div>
          <p className="font-medium">{item.title}</p>
          {item.description && (
            <p className="text-muted-foreground line-clamp-1 text-sm">{item.description}</p>
          )}
        </div>
      ),
    },
    {
      id: "type",
      header: "Type",
      sortValue: (item) => item.type ?? "",
      cell: (item) => <StatusBadge tone="neutral">{item.type ?? "activity"}</StatusBadge>,
    },
    {
      id: "starts",
      header: "Starts",
      sortValue: (item) => item.startsAt,
      cell: (item) => (
        <span className="font-mono text-xs tabular-nums">
          {formatScheduledDateTime(item.startsAt)}
        </span>
      ),
    },
    {
      id: "visibility",
      header: "Visibility",
      sortValue: (item) => item.visibility ?? "",
      cell: (item) => (
        <StatusBadge tone={visibilityTone(item.visibility)} dot={false}>
          {item.visibility ?? "public"}
        </StatusBadge>
      ),
    },
    {
      id: "location",
      header: "Location",
      sortValue: (item) => item.location ?? "",
      cell: (item) => item.location ?? <span className="text-muted-foreground">-</span>,
    },
  ];

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title="Schedule"
        description="Create event calendar items and batch show/hide them on the public agenda."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            New item
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(item) => String(item.id)}
        loading={loading}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        searchable={(item) => `${item.title} ${item.type ?? ""} ${item.location ?? ""}`}
        searchPlaceholder="Search schedule..."
        pageSize={20}
        rowActions={(item) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Edit item"
              onClick={() => setEditing(item)}
            >
              <PencilIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete item"
              className="text-destructive"
              disabled={busy}
              onClick={() => void remove(item)}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        )}
        toolbar={
          selectedIds.size > 0 ? (
            <>
              <span className="text-muted-foreground text-sm">{selectedIds.size} selected</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setVisibility("shown")}
              >
                <EyeIcon className="size-4" />
                Show
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setVisibility("hidden")}
              >
                <EyeOffIcon className="size-4" />
                Hide
              </Button>
            </>
          ) : undefined
        }
        empty={{
          icon: CalendarDaysIcon,
          title: "No schedule items yet",
          description: "Create the first event calendar item.",
        }}
      />

      <ScheduleFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New schedule item"
        initial={EMPTY_FORM}
        onSubmit={async (values) => {
          await logisticsApi.createSchedule(cleanForm(values));
          toast.success("Schedule item created.");
          setCreateOpen(false);
          await load();
        }}
      />

      {editing && (
        <ScheduleFormModal
          open={Boolean(editing)}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          title="Edit schedule item"
          initial={toForm(editing)}
          onSubmit={async (values) => {
            await logisticsApi.updateSchedule(editing.id, cleanForm(values));
            toast.success("Schedule item updated.");
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ScheduleFormModal({
  open,
  onOpenChange,
  title,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial: ScheduleInput;
  onSubmit: (values: ScheduleInput) => Promise<void>;
}) {
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setValues(initial);
  }, [initial]);

  async function submit() {
    setPending(true);
    try {
      await onSubmit(values);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save schedule item.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} icon={CalendarDaysIcon} size="lg">
      <div className="space-y-4">
        <Field label="Title">
          <Input
            value={values.title}
            onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
            placeholder="Opening ceremony"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <Select
              value={values.type ?? "activity"}
              onValueChange={(type) =>
                setValues((v) => ({ ...v, type, requiresScan: type === "meal" || v.requiresScan }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Visibility">
            <Select
              value={values.visibility}
              onValueChange={(visibility) =>
                setValues((v) => ({ ...v, visibility: visibility as "shown" | "hidden" }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hidden">Hidden</SelectItem>
                <SelectItem value="shown">Shown</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="requires-scan"
            checked={values.type === "meal" || values.requiresScan === true}
            disabled={values.type === "meal"}
            onCheckedChange={(checked) =>
              setValues((v) => ({ ...v, requiresScan: checked === true }))
            }
          />
          <Label htmlFor="requires-scan" className="font-normal">
            Registrable by scanner{values.type === "meal" ? " (meals are always registrable)" : ""}
          </Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts">
            <ScheduledDateTimeField
              value={values.startsAt}
              onChange={(startsAt) => setValues((v) => ({ ...v, startsAt }))}
              addLabel="Add start time"
            />
          </Field>
          <Field label="Ends">
            <ScheduledDateTimeField
              value={values.endsAt}
              onChange={(endsAt) => setValues((v) => ({ ...v, endsAt }))}
              addLabel="Add end time"
            />
          </Field>
        </div>
        <Field label="Publish at">
          <ScheduledDateTimeField
            value={values.publishAt ?? ""}
            onChange={(publishAt) => setValues((v) => ({ ...v, publishAt: publishAt || null }))}
            emptyLabel="Immediate"
            addLabel="Schedule publication"
          />
        </Field>
        <Field label="Location">
          <Input
            value={values.location ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, location: e.target.value }))}
            placeholder="Main hall"
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={values.description ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            placeholder="Visible in the public agenda when shown."
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton
            pending={pending}
            onClick={submit}
            disabled={!values.title || !values.startsAt || !values.endsAt}
          >
            Save
          </SubmitButton>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
