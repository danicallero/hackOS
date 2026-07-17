"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  CalendarDaysIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MicIcon,
  PartyPopperIcon,
  PencilIcon,
  PlusIcon,
  ScanLineIcon,
  SparklesIcon,
  Trash2Icon,
  UtensilsIcon,
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
import { formatScheduledDateTime, getTimeZoneLabel } from "@/lib/datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem, type ScheduleInput } from "@/lib/logistics";
import { useCan } from "@/lib/session";
import type { Tone } from "@/lib/tones";

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

function toDuplicateForm(item: PublicScheduleItem): ScheduleInput {
  return {
    ...toForm(item),
    title: `${item.title} (copy)`,
    // A duplicated item should not unexpectedly appear on the public agenda.
    visibility: "hidden",
    publishAt: null,
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

function typeLabel(type: string | null | undefined, t: Translate): string {
  const map: Record<string, string> = {
    activity: t("typeActivity"),
    meal: t("typeMeal"),
    workshop: t("typeWorkshop"),
    talk: t("typeTalk"),
    ceremony: t("typeCeremony"),
    other: t("typeOther"),
  };
  return (type && map[type]) || t("typeActivity");
}

const TYPE_ICONS: Record<string, typeof CalendarDaysIcon> = {
  activity: SparklesIcon,
  meal: UtensilsIcon,
  workshop: MicIcon,
  talk: MicIcon,
  ceremony: PartyPopperIcon,
  other: CalendarDaysIcon,
};

function typeIcon(type: string | null | undefined) {
  return (type && TYPE_ICONS[type]) || CalendarDaysIcon;
}

/**
 * Programme items expose one of five states so staff and public readers can
 * tell what is public now, upcoming, or over without inspecting raw
 * visibility/publishAt fields (H47, H48).
 */
type ScheduleStatus = "draft" | "scheduled" | "public" | "active" | "ended";

function scheduleStatus(item: PublicScheduleItem): ScheduleStatus {
  const now = Date.now();
  const publishAtMs = item.publishAt ? new Date(item.publishAt).getTime() : null;
  const isVisible = item.visibility === "shown" || (publishAtMs !== null && publishAtMs <= now);
  if (!isVisible) return publishAtMs !== null ? "scheduled" : "draft";
  const startsMs = new Date(item.startsAt).getTime();
  const endsMs = new Date(item.endsAt).getTime();
  if (!Number.isNaN(endsMs) && endsMs <= now) return "ended";
  if (!Number.isNaN(startsMs) && startsMs <= now) return "active";
  return "public";
}

const STATUS_TONE: Record<ScheduleStatus, Tone> = {
  draft: "neutral",
  scheduled: "warning",
  public: "info",
  active: "success",
  ended: "neutral",
};

function scheduleStatusLabel(status: ScheduleStatus, t: Translate): string {
  const map: Record<ScheduleStatus, string> = {
    draft: t("statusDraft"),
    scheduled: t("statusScheduled"),
    public: t("statusPublic"),
    active: t("statusLive"),
    ended: t("statusEnded"),
  };
  return map[status];
}

export default function SchedulePage() {
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.SCHEDULE_MANAGE);
  const [items, setItems] = useState<PublicScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PublicScheduleItem | null>(null);
  const [duplicating, setDuplicating] = useState<PublicScheduleItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<{
    message: string;
    onRetry?: () => void;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await logisticsApi.schedule();
      setItems(result.items);
      setSelectedIds(new Set());
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadSchedule");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // edits the schedule elsewhere (H47).
  const liveRefresh = useAutoRefresh("/api/content/stream", [EVENTS.CONTENT_SCHEDULE_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (canManage) void load();
    else setLoading(false);
  }, [canManage, load, liveRefresh]);

  async function setVisibility(visibility: "shown" | "hidden", ids = [...selectedIds].map(Number)) {
    if (ids.length === 0) return;
    setBusy(true);
    setMutationError(null);
    try {
      await logisticsApi.setScheduleVisibility(ids, visibility);
      toast.success(visibility === "shown" ? t("itemsShown") : t("itemsHidden"));
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotUpdateVisibility");
      setMutationError({
        message,
        onRetry: () => void setVisibility(visibility, ids),
      });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: PublicScheduleItem) {
    setBusy(true);
    setMutationError(null);
    try {
      await logisticsApi.deleteSchedule(item.id);
      toast.success(t("scheduleItemDeleted"));
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotDeleteScheduleItem");
      setMutationError({ message });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("schedule")} />
        <EmptyState
          icon={LockIcon}
          title={t("noAccessSchedule")}
          description={t("scheduleDeniedDesc")}
        />
      </div>
    );
  }

  const columns: Column<PublicScheduleItem>[] = [
    {
      id: "title",
      header: t("colItem"),
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
      header: t("colType"),
      sortValue: (item) => item.type ?? "",
      cell: (item) => {
        const Icon = typeIcon(item.type);
        return (
          <div className="flex items-center gap-2">
            <StatusBadge tone="neutral" dot={false}>
              <Icon className="size-3.5" aria-hidden="true" />
              {typeLabel(item.type, t)}
            </StatusBadge>
            {item.requiresScan && (
              <span
                className="text-muted-foreground inline-flex items-center gap-1 text-xs"
                title={t("registrableByScanner")}
              >
                <ScanLineIcon className="size-3.5" aria-hidden="true" />
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "starts",
      header: t("colStarts"),
      sortValue: (item) => item.startsAt,
      cell: (item) => (
        <span className="font-mono text-xs tabular-nums">
          {formatScheduledDateTime(item.startsAt)}
        </span>
      ),
    },
    {
      id: "status",
      header: t("colStatus"),
      sortValue: (item) => scheduleStatus(item),
      cell: (item) => {
        const status = scheduleStatus(item);
        return (
          <StatusBadge tone={STATUS_TONE[status]}>{scheduleStatusLabel(status, t)}</StatusBadge>
        );
      },
    },
    {
      id: "location",
      header: t("locationLabel"),
      sortValue: (item) => item.location ?? "",
      cell: (item) => item.location ?? <span className="text-muted-foreground">-</span>,
    },
  ];
  const selectedItem =
    selectedIds.size === 1 ? items.find((item) => selectedIds.has(String(item.id))) : undefined;

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title={t("schedule")}
        description={t("scheduleManageDesc")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            {t("newItem")}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(item) => String(item.id)}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        mutationError={mutationError ?? undefined}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        searchable={(item) => `${item.title} ${item.type ?? ""} ${item.location ?? ""}`}
        searchPlaceholder={t("searchSchedulePlaceholder")}
        pageSize={20}
        rowActions={(item) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("editItemAria")}
              onClick={() => setEditing(item)}
            >
              <PencilIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("deleteItemAria")}
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
              <span className="text-muted-foreground text-sm">
                {t("selectedCount", { count: selectedIds.size })}
              </span>
              {selectedItem && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDuplicating(selectedItem)}
                >
                  <CopyIcon className="size-4" />
                  {t("duplicate")}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setVisibility("shown")}
              >
                <EyeIcon className="size-4" />
                {t("show")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setVisibility("hidden")}
              >
                <EyeOffIcon className="size-4" />
                {t("hide")}
              </Button>
            </>
          ) : undefined
        }
        empty={{
          icon: CalendarDaysIcon,
          title: t("noScheduleItemsYet"),
          description: t("createFirstEventItem"),
        }}
      />

      <ScheduleFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("newScheduleItem")}
        initial={EMPTY_FORM}
        onSubmit={async (values) => {
          await logisticsApi.createSchedule(cleanForm(values));
          toast.success(t("scheduleItemCreated"));
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
          title={t("editScheduleItem")}
          initial={toForm(editing)}
          onSubmit={async (values) => {
            await logisticsApi.updateSchedule(editing.id, cleanForm(values));
            toast.success(t("scheduleItemUpdated"));
            setEditing(null);
            await load();
          }}
        />
      )}

      {duplicating && (
        <ScheduleFormModal
          open={Boolean(duplicating)}
          onOpenChange={(open) => {
            if (!open) setDuplicating(null);
          }}
          title={t("duplicateScheduleItem")}
          initial={toDuplicateForm(duplicating)}
          onSubmit={async (values) => {
            await logisticsApi.createSchedule(cleanForm(values));
            toast.success(t("scheduleItemDuplicated"));
            setDuplicating(null);
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
  const { t } = useLocale();
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
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} icon={CalendarDaysIcon} size="lg">
      <div className="space-y-4">
        <Field label={t("titleLabel")}>
          <Input
            value={values.title}
            onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
            placeholder={t("openingCeremonyPlaceholder")}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("colType")}>
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
                    {typeLabel(type, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("colVisibility")}>
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
                <SelectItem value="hidden">{t("hiddenOption")}</SelectItem>
                <SelectItem value="shown">{t("shownOption")}</SelectItem>
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
            {t("registrableByScanner")}
            {values.type === "meal" ? t("mealsAlwaysRegistrable") : ""}
          </Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("colStarts")}>
            <ScheduledDateTimeField
              value={values.startsAt}
              onChange={(startsAt) => setValues((v) => ({ ...v, startsAt }))}
              addLabel={t("addStartTime")}
            />
          </Field>
          <Field label={t("endsLabel")}>
            <ScheduledDateTimeField
              value={values.endsAt}
              onChange={(endsAt) => setValues((v) => ({ ...v, endsAt }))}
              addLabel={t("addEndTime")}
            />
          </Field>
        </div>
        <Field label={t("publishAtLabel")}>
          <ScheduledDateTimeField
            value={values.publishAt ?? ""}
            onChange={(publishAt) => setValues((v) => ({ ...v, publishAt: publishAt || null }))}
            emptyLabel={t("immediate")}
            addLabel={t("schedulePublication")}
            description={t("publishDestinationsHint", { timezone: getTimeZoneLabel() })}
          />
        </Field>
        <Field label={t("locationLabel")}>
          <Input
            value={values.location ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, location: e.target.value }))}
            placeholder={t("mainHallPlaceholder")}
          />
        </Field>
        <Field label={t("descriptionLabel")}>
          <Textarea
            value={values.description ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            placeholder={t("visibleInPublicAgenda")}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <SubmitButton
            pending={pending}
            onClick={submit}
            disabled={!values.title || !values.startsAt || !values.endsAt}
          >
            {t("save")}
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
