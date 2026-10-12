"use client";

// Live Activities category (#966, H8): which Live Activity kinds exist, which
// roles see each one, whether it is on, and their priority — list position is
// priority, highest first, and only the top `maxConcurrent` a person qualifies
// for are shown at once. Modelled on the roles manager (list + editor, mobile
// drill-down), but every edit stays in this category's one draft and save
// footer (R011): the PUT replaces the whole configuration.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  LIVE_ACTIVITY_LEAD_MINUTES_MAX,
  LIVE_ACTIVITY_LEAD_MINUTES_MIN,
  LIVE_ACTIVITY_MAX_CONCURRENT_MAX,
  LIVE_ACTIVITY_MAX_CONCURRENT_MIN,
  type LiveActivityConfigKind,
  type LiveActivityKindSetting,
  type LiveActivitySettings,
} from "@hackos/shared/live-activities";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { DragHandle, SortableItem } from "@/components/common/drag-handle";
import { FormActions } from "@/components/common/form-actions";
import { IconButton } from "@/components/common/icon-button";
import { SectionCard } from "@/components/common/section-card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Section } from "@/components/ui/surface";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiError, api } from "@/lib/api";
import { type MessageKey, type Translate, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { capabilityDescription, prettifyCapability } from "../../permissions/helpers";
import { DrilldownBackButton } from "../../permissions/role-editor";
import { useCategorySaveState } from "./use-category-save-state";

type LiveActivityRole = LiveActivitySettings["roles"][number];

const MAX_CONCURRENT_OPTIONS = Array.from(
  { length: LIVE_ACTIVITY_MAX_CONCURRENT_MAX - LIVE_ACTIVITY_MAX_CONCURRENT_MIN + 1 },
  (_, i) => LIVE_ACTIVITY_MAX_CONCURRENT_MIN + i,
);

const KIND_COPY: Record<LiveActivityConfigKind, { name: MessageKey; description: MessageKey }> = {
  activity: { name: "liveActivityKindActivity", description: "liveActivityKindActivityDesc" },
  attendee_activity: {
    name: "liveActivityKindAttendeeActivity",
    description: "liveActivityKindAttendeeActivityDesc",
  },
  queue: { name: "liveActivityKindQueue", description: "liveActivityKindQueueDesc" },
  deadline: { name: "liveActivityKindDeadline", description: "liveActivityKindDeadlineDesc" },
  accreditation: {
    name: "liveActivityKindAccreditation",
    description: "liveActivityKindAccreditationDesc",
  },
};

export function liveActivityKindName(kind: LiveActivityConfigKind, t: Translate): string {
  return t(KIND_COPY[kind].name);
}

type DraftKind = Pick<
  LiveActivityKindSetting,
  "kind" | "enabled" | "roleIds" | "requiredCapability"
>;
interface Draft {
  maxConcurrent: number;
  /** Minutes before a schedule item starts; null while the field is empty or out of range. */
  leadMinutes: number | null;
  defaultLeadMinutes: number;
  kinds: DraftKind[];
}

function toDraft(settings: LiveActivitySettings): Draft {
  return {
    maxConcurrent: settings.maxConcurrent,
    leadMinutes: settings.leadMinutes,
    defaultLeadMinutes: settings.defaultLeadMinutes,
    kinds: [...settings.kinds]
      .sort((a, b) => a.priority - b.priority)
      .map(({ kind, enabled, roleIds, requiredCapability }) => ({
        kind,
        enabled,
        roleIds: [...roleIds].sort((a, b) => a - b),
        requiredCapability,
      })),
  };
}

/** PUT body: array order is priority (0 = highest), every kind exactly once. */
export function toPayload(draft: Draft) {
  return {
    maxConcurrent: draft.maxConcurrent,
    leadMinutes: draft.leadMinutes,
    kinds: draft.kinds.map(({ kind, enabled, roleIds }) => ({ kind, enabled, roleIds })),
  };
}

const samePayload = (a: Draft, b: Draft) =>
  JSON.stringify(toPayload(a)) === JSON.stringify(toPayload(b));

export function LiveActivitiesTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  // The settings response carries every assignable role, so a manager without
  // roles-manager access can still target them (#966, H8).
  const [roles, setRoles] = useState<LiveActivityRole[]>([]);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<LiveActivityConfigKind | null>(null);
  const [pending, setPending] = useState(false);

  const isDirty = saved !== null && draft !== null && !samePayload(saved, draft);
  const leadInvalid = draft !== null && draft.leadMinutes === null;
  const [saveState, setSaveState] = useCategorySaveState(isDirty, onDirtyChange);

  const load = useCallback(async () => {
    setStatus("loading");
    setLoadError(null);
    try {
      const settings = await api.get<LiveActivitySettings>("/api/live-activities/settings");
      const next = toDraft(settings);
      setRoles(settings.roles);
      setSaved(next);
      setDraft(next);
      setStatus("ready");
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t("couldNotLoadLiveActivities"));
      setStatus("error");
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetching the settings is an external-system sync on mount.
    void load();
  }, [load]);

  function updateKind(kind: LiveActivityConfigKind, patch: Partial<DraftKind>) {
    setDraft((prev) =>
      prev
        ? { ...prev, kinds: prev.kinds.map((k) => (k.kind === kind ? { ...k, ...patch } : k)) }
        : prev,
    );
  }

  function move(kind: LiveActivityConfigKind, toIndex: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const from = prev.kinds.findIndex((k) => k.kind === kind);
      if (from === -1 || toIndex < 0 || toIndex >= prev.kinds.length || from === toIndex) {
        return prev;
      }
      return { ...prev, kinds: arrayMove(prev.kinds, from, toIndex) };
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || pending || draft.leadMinutes === null) return;
    setPending(true);
    setSaveState("saving");
    try {
      const settings = await api.put<LiveActivitySettings>(
        "/api/live-activities/settings",
        toPayload(draft),
      );
      const next = toDraft(settings);
      setRoles(settings.roles);
      setSaved(next);
      setDraft(next);
      setSaveState("saved");
      toast.success(t("saved"), { compactTitle: t("liveActivitiesTitle") });
    } catch (err) {
      setSaveState("error");
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotSaveLiveActivities"),
        t("liveActivitiesTitle"),
      );
    } finally {
      setPending(false);
    }
  }

  if (status === "error") {
    return (
      <ContextualError
        message={loadError ?? t("couldNotLoadLiveActivities")}
        onRetry={() => void load()}
      />
    );
  }
  if (status === "loading" || !draft) {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label={t("loading")}>
        <Skeleton className="h-[var(--control-height-default)] w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const current =
    draft.kinds.find((k) => k.kind === selected) ?? (isMobile ? null : draft.kinds[0]);
  const currentIndex = current ? draft.kinds.indexOf(current) : -1;

  const list = (
    <KindList
      kinds={draft.kinds}
      roles={roles}
      selected={current?.kind ?? null}
      mobile={isMobile}
      onSelect={setSelected}
      onToggle={(kind, enabled) => updateKind(kind, { enabled })}
      onMove={move}
    />
  );

  const editor = current && (
    <KindEditor
      setting={current}
      index={currentIndex}
      count={draft.kinds.length}
      roles={roles}
      onChange={(patch) => updateKind(current.kind, patch)}
      onMove={(toIndex) => move(current.kind, toIndex)}
    />
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <SectionCard
        variant="plain"
        footerClassName="justify-start"
        stickyFooter
        footer={
          <FormActions pending={pending} state={saveState} disabled={!isDirty || leadInvalid} />
        }
      >
        <div className="space-y-6">
          {!(isMobile && current) && (
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="live-activities-max">{t("liveActivitiesMaxConcurrent")}</Label>
              <Select
                value={String(draft.maxConcurrent)}
                onValueChange={(value) =>
                  setDraft((prev) => (prev ? { ...prev, maxConcurrent: Number(value) } : prev))
                }
              >
                <SelectTrigger id="live-activities-max" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_CONCURRENT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label htmlFor="live-activities-lead">{t("liveActivitiesLeadMinutes")}</Label>
              <Input
                id="live-activities-lead"
                type="number"
                inputMode="numeric"
                min={LIVE_ACTIVITY_LEAD_MINUTES_MIN}
                max={LIVE_ACTIVITY_LEAD_MINUTES_MAX}
                className="w-24"
                value={draft.leadMinutes ?? ""}
                aria-invalid={leadInvalid || undefined}
                onChange={(e) => {
                  const raw = e.target.value;
                  const value = Number(raw);
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          leadMinutes:
                            raw !== "" &&
                            Number.isInteger(value) &&
                            value >= LIVE_ACTIVITY_LEAD_MINUTES_MIN &&
                            value <= LIVE_ACTIVITY_LEAD_MINUTES_MAX
                              ? value
                              : null,
                        }
                      : prev,
                  );
                }}
              />
              {draft.leadMinutes !== draft.defaultLeadMinutes && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft((prev) =>
                      prev ? { ...prev, leadMinutes: prev.defaultLeadMinutes } : prev,
                    )
                  }
                >
                  {t("liveActivitiesLeadReset", { minutes: draft.defaultLeadMinutes })}
                </Button>
              )}
            </div>
          )}

          {isMobile ? (
            current ? (
              <div className="space-y-4">
                <DrilldownBackButton
                  label={t("liveActivitiesTitle")}
                  onClick={() => setSelected(null)}
                />
                {editor}
              </div>
            ) : (
              list
            )
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
              {list}
              {editor}
            </div>
          )}
        </div>
      </SectionCard>
    </form>
  );
}

function KindList({
  kinds,
  roles,
  selected,
  mobile,
  onSelect,
  onToggle,
  onMove,
}: {
  kinds: DraftKind[];
  roles: LiveActivityRole[];
  selected: LiveActivityConfigKind | null;
  mobile: boolean;
  onSelect: (kind: LiveActivityConfigKind) => void;
  onToggle: (kind: LiveActivityConfigKind, enabled: boolean) => void;
  onMove: (kind: LiveActivityConfigKind, toIndex: number) => void;
}) {
  const { t } = useLocale();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const toIndex = kinds.findIndex((k) => k.kind === over.id);
    if (toIndex !== -1) onMove(active.id as LiveActivityConfigKind, toIndex);
  }

  return (
    <Section padding="none" className="overflow-hidden">
      <p className="type-label text-muted-foreground border-b px-4 py-2.5">{t("priorityLabel")}</p>
      <ul className="divide-border divide-y" aria-label={t("liveActivitiesTitle")}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={kinds.map((k) => k.kind)} strategy={verticalListSortingStrategy}>
            {kinds.map((setting, index) => {
              const name = liveActivityKindName(setting.kind, t);
              const summary = roleSummary(setting.roleIds, roles, t);
              return (
                <SortableItem key={setting.kind} id={setting.kind}>
                  {({ attributes, listeners }) => (
                    <li
                      className={cn(
                        "flex items-center gap-2 px-2",
                        selected === setting.kind && "bg-muted",
                      )}
                    >
                      <DragHandle
                        attributes={attributes}
                        listeners={listeners}
                        label={t("dragToReorderAria", { name })}
                      />
                      <span className="text-muted-foreground w-4 shrink-0 text-center text-xs tabular-nums">
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelect(setting.kind)}
                        aria-current={selected === setting.kind ? "true" : undefined}
                        className="button-interaction flex min-w-0 flex-1 items-center justify-between gap-2 py-2.5 text-left"
                      >
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block truncate text-sm font-medium",
                              !setting.enabled && "text-muted-foreground",
                            )}
                          >
                            {name}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {summary}
                          </span>
                        </span>
                        {mobile && (
                          <CaretRightIcon
                            aria-hidden="true"
                            className="text-muted-foreground size-4 shrink-0"
                          />
                        )}
                      </button>
                      <Switch
                        checked={setting.enabled}
                        onCheckedChange={(checked) => onToggle(setting.kind, checked)}
                        aria-label={t("liveActivityEnableAria", { name })}
                      />
                    </li>
                  )}
                </SortableItem>
              );
            })}
          </SortableContext>
        </DndContext>
      </ul>
    </Section>
  );
}

/** Role names in the roles manager's order (highest position first). */
function roleSummary(roleIds: number[], roles: LiveActivityRole[], t: Translate): string {
  const selected = new Set(roleIds);
  const names = roles.filter((r) => selected.has(r.id)).map((r) => r.name);
  if (names.length === 0) return t("liveActivityNoRoles");
  if (names.length === roles.length) return t("liveActivityAllRoles");
  return names.join(", ");
}

function KindEditor({
  setting,
  index,
  count,
  roles,
  onChange,
  onMove,
}: {
  setting: DraftKind;
  index: number;
  count: number;
  roles: LiveActivityRole[];
  onChange: (patch: Partial<DraftKind>) => void;
  onMove: (toIndex: number) => void;
}) {
  const { t } = useLocale();
  const name = liveActivityKindName(setting.kind, t);
  const selectedRoles = new Set(setting.roleIds);
  const switchId = `live-activity-${setting.kind}-enabled`;

  function toggleRole(roleId: number, checked: boolean) {
    const next = new Set(selectedRoles);
    if (checked) next.add(roleId);
    else next.delete(roleId);
    onChange({ roleIds: [...next].sort((a, b) => a - b) });
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-section-title min-w-0 truncate">{name}</h2>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              variant="ghost"
              size="icon-sm"
              label={t("moveUp")}
              disabled={index <= 0}
              onClick={() => onMove(index - 1)}
            >
              <ArrowUpIcon aria-hidden="true" />
            </IconButton>
            <IconButton
              variant="ghost"
              size="icon-sm"
              label={t("moveDown")}
              disabled={index >= count - 1}
              onClick={() => onMove(index + 1)}
            >
              <ArrowDownIcon aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">{t(KIND_COPY[setting.kind].description)}</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={switchId} className="font-normal">
          {t("grantRuleEnabledLabel")}
        </Label>
        <Switch
          id={switchId}
          checked={setting.enabled}
          onCheckedChange={(enabled) => onChange({ enabled })}
        />
      </div>

      {setting.requiredCapability && (
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">{t("liveActivityRequiredPermission")}</p>
          <p className="text-sm font-medium">{prettifyCapability(setting.requiredCapability, t)}</p>
          {capabilityDescription(setting.requiredCapability, t) && (
            <p className="text-muted-foreground text-xs">
              {capabilityDescription(setting.requiredCapability, t)}
            </p>
          )}
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className="type-label text-muted-foreground mb-3">{t("rolesTitle")}</legend>
        {setting.enabled && setting.roleIds.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("liveActivityNoRolesHint")}</p>
        )}
        {roles.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {roles.map((role) => {
              const id = `live-activity-${setting.kind}-role-${role.id}`;
              return (
                <li key={role.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={selectedRoles.has(role.id)}
                    onCheckedChange={(checked) => toggleRole(role.id, checked === true)}
                  />
                  <Label htmlFor={id} className="min-w-0 truncate font-normal">
                    {role.name}
                  </Label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
    </div>
  );
}
