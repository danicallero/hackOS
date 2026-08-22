"use client";
import { XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { DateTimeInput } from "@/components/common/datetime-input";
import { StatusBadge } from "@/components/common/status-badge";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { formatScheduledDateTime, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem, type ScheduleAudience } from "@/lib/logistics";
import { commitAndNavigate, handleScheduleGridKeyDown, refocusScheduleCell } from "./schedule-grid";
import {
  editingNavigationDirection,
  ownerDisplayName,
  ownerNames,
  parseTimeOfDay,
  SCHEDULE_AUDIENCES,
  SCHEDULE_STATUS_TONES,
  type ScheduleStatus,
  scheduleAudienceLabel,
  type scheduleStatus,
  scheduleStatusLabel,
} from "./schedule-model";

// The inline editors of the Manage Schedule table (H59): one cell per column,
// each owning its own open/saving state and committing through the row's
// `save*` callbacks. Extracted from page.tsx, which the page-size ratchet
// keeps to the page itself.

export function StatusPill({
  item,
  status,
}: {
  item: PublicScheduleItem;
  status: ReturnType<typeof scheduleStatus>;
}) {
  const { t } = useLocale();
  if (status === "staffOnly") {
    return (
      <span className="text-muted-foreground" title={t("staffSeeAllHint")}>
        —
      </span>
    );
  }
  const badge = (
    <StatusBadge tone={SCHEDULE_STATUS_TONES[status]}>{scheduleStatusLabel(status, t)}</StatusBadge>
  );
  if (status === "scheduled" && item.publishAt) {
    return <span title={new Date(item.publishAt).toLocaleString()}>{badge}</span>;
  }
  return badge;
}

/**
 * Status cell (H59): reads as the plain state badge (Hidden / Scheduled /
 * Shown / Staff only) and opens a two-option menu so staff can flip an item
 * between shown and hidden without opening the editor. Deliberately a bare
 * badge rather than a bordered `<Select>` — a pill nested inside a second box
 * with its own chevron reads as two controls, and this column is scanned far
 * more often than it's edited (docs/DESIGN.md § container hierarchy).
 */
export function EditableStatusCell({
  item,
  status,
  disabled,
  disabledHint,
  fieldLabel,
  onSave,
}: {
  item: PublicScheduleItem;
  status: ScheduleStatus;
  disabled: boolean;
  disabledHint?: string;
  fieldLabel: string;
  onSave: (next: "shown" | "hidden") => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function change(next: string) {
    if (next !== "shown" && next !== "hidden") return;
    setSaving(true);
    try {
      const result = await onSave(next);
      if (result !== false) setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
    } finally {
      setSaving(false);
    }
  }

  if (disabled) {
    return (
      <span title={disabledHint} className="block">
        <StatusPill item={item} status={status} />
      </span>
    );
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          aria-label={t("editScheduleFieldAria", { field: fieldLabel })}
          onKeyDown={(event) => {
            if (open && event.key !== "Tab") return;
            handleScheduleGridKeyDown(event);
          }}
          data-schedule-focusable="true"
          data-schedule-activate="true"
          className="hover:bg-muted -mx-1 block rounded px-1 py-0.5 text-left"
        >
          <StatusPill item={item} status={status} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={item.visibility ?? "hidden"}
          onValueChange={(next) => void change(next)}
        >
          <DropdownMenuRadioItem value="shown">{t("shownOption")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="hidden">{t("hiddenOption")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type CellSaveResult = boolean | undefined;

/**
 * Click (mouse or keyboard Enter/Space on the focused trigger) to edit;
 * Enter or blur commits, Escape reverts — the same contract for every
 * inline-editable cell in this table (H59).
 */
export function EditableTextCell({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder?: string;
  onSave: (next: string) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit(nextDraft = draft): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    try {
      const result = await onSave(nextDraft);
      const saved = result !== false;
      if (saved) setEditing(false);
      return saved;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        onKeyDown={handleScheduleGridKeyDown}
        data-schedule-focusable="true"
        data-schedule-activate="true"
        className="hover:bg-muted -mx-1 block w-full truncate rounded px-1 py-0.5 text-left"
      >
        {value || <span className="text-muted-foreground">{placeholder ?? "—"}</span>}
      </button>
    );
  }
  // Pops out over neighboring cells instead of clipping when the column is
  // narrower than the content being edited (H59) — the cell itself has no
  // overflow-hidden, so this is free to render past the column's edge.
  return (
    <div
      className="bg-popover border-border absolute inset-y-0 left-0 z-20 flex items-center rounded-md border shadow-md"
      style={{ width: "max(100%, 12rem)" }}
    >
      <Input
        ref={inputRef}
        value={draft}
        disabled={saving}
        data-schedule-focusable="true"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(event) => void commit(event.currentTarget.value)}
        onKeyDown={(e) => {
          if (editingNavigationDirection(e)) {
            void commitAndNavigate(e, () => commit(e.currentTarget.value));
            return;
          }
          const input = e.currentTarget;
          if (e.key === "Enter") {
            e.preventDefault();
            void commit(input.value).then(() => refocusScheduleCell(input));
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
            refocusScheduleCell(input);
          }
        }}
        className="h-7 w-full border-0 bg-transparent text-sm shadow-none"
      />
    </div>
  );
}

/**
 * Plain HH:MM text field, not the native `<input type="time">` — that
 * control's AM/PM-vs-24h rendering follows the OS locale, not this app's
 * locale, so it can't guarantee a 24-hour clock across browsers/systems.
 * What's typed is read leniently (parseTimeOfDay: "9", "9:0", "930" all mean
 * 09:00/09:30) and committed canonical, so a run-of-show can be typed at
 * speed without four digits and a colon every time.
 */
export function EditableTimeCell({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit(nextDraft = draft): Promise<boolean> {
    if (saving) return false;
    const parsed = parseTimeOfDay(nextDraft);
    if (!parsed) {
      setDraft(value);
      setEditing(false);
      return false;
    }
    setDraft(parsed);
    setSaving(true);
    try {
      const result = await onSave(parsed);
      const saved = result !== false;
      if (saved) setEditing(false);
      return saved;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        onKeyDown={handleScheduleGridKeyDown}
        data-schedule-focusable="true"
        data-schedule-activate="true"
        className="hover:bg-muted -mx-1 w-full rounded px-1 py-0.5 text-left"
      >
        {value}
      </button>
    );
  }
  return (
    <div
      className="bg-popover border-border absolute inset-y-0 left-0 z-20 flex items-center rounded-md border shadow-md"
      style={{ width: "max(100%, 6rem)" }}
    >
      <Input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        value={draft}
        disabled={saving}
        data-schedule-focusable="true"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(event) => void commit(event.currentTarget.value)}
        onKeyDown={(e) => {
          if (editingNavigationDirection(e)) {
            void commitAndNavigate(e, () => commit(e.currentTarget.value));
            return;
          }
          const input = e.currentTarget;
          if (e.key === "Enter") {
            e.preventDefault();
            void commit(input.value).then(() => refocusScheduleCell(input));
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
            refocusScheduleCell(input);
          }
        }}
        className="h-7 w-full border-0 bg-transparent font-mono text-sm tabular-nums shadow-none"
      />
    </div>
  );
}

const EMPTY_SCHEDULE_TYPE = "__schedule_type_none__";

export function EditableSelectCell({
  value,
  options,
  labelForOption,
  emptyLabel,
  fieldLabel,
  onSave,
}: {
  value: string | null | undefined;
  options: string[];
  labelForOption: (value: string) => string;
  emptyLabel: string;
  fieldLabel: string;
  onSave: (next: string | null) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function change(next: string) {
    setSaving(true);
    try {
      const result = await onSave(next === EMPTY_SCHEDULE_TYPE ? null : next);
      if (result !== false) setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Select
      value={value ?? EMPTY_SCHEDULE_TYPE}
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
      onValueChange={(next) => void change(next)}
    >
      <SelectTrigger
        size="sm"
        disabled={saving}
        aria-label={t("editScheduleFieldAria", { field: fieldLabel })}
        onKeyDown={(event) => {
          // Once the menu is open, the native select keyboard controls the
          // options. The table-level arrows apply to the closed cell trigger.
          if (open && event.key !== "Tab") return;
          handleScheduleGridKeyDown(event);
        }}
        data-schedule-focusable="true"
        data-schedule-activate="true"
        className="w-full border-0 bg-transparent px-1 shadow-none"
      >
        <SelectValue placeholder={emptyLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY_SCHEDULE_TYPE}>{emptyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {labelForOption(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function audienceSummary(
  audiences: ScheduleAudience[],
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (audiences.length === 0) return t("audienceFilterStaffOnly");
  return audiences.map((audience) => scheduleAudienceLabel(audience, t)).join(", ");
}

export function EditableAudienceCell({
  audiences,
  fieldLabel,
  onSave,
}: {
  audiences: ScheduleAudience[];
  fieldLabel: string;
  onSave: (next: ScheduleAudience[]) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScheduleAudience[]>(audiences);
  const [saving, setSaving] = useState(false);

  function setPopoverOpen(next: boolean) {
    if (next) setDraft(audiences);
    setOpen(next);
  }

  function toggle(audience: ScheduleAudience, checked: boolean) {
    setDraft((current) => {
      const next = new Set(current);
      if (checked) next.add(audience);
      else next.delete(audience);
      return SCHEDULE_AUDIENCES.filter((option) => next.has(option));
    });
  }

  async function apply() {
    setSaving(true);
    try {
      const result = await onSave(draft);
      if (result !== false) setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className="hover:bg-muted -mx-1 block w-full truncate rounded px-1 py-0.5 text-left"
          aria-label={t("editScheduleFieldAria", { field: fieldLabel })}
          onKeyDown={handleScheduleGridKeyDown}
          data-schedule-focusable="true"
          data-schedule-activate="true"
        >
          {audienceSummary(audiences, t)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <div className="space-y-1">
          {SCHEDULE_AUDIENCES.map((audience) => (
            <div key={audience} className="flex items-center gap-2 py-1 text-sm">
              <Checkbox
                id={`${inputId}-${audience}`}
                checked={draft.includes(audience)}
                disabled={saving}
                onCheckedChange={(checked) => toggle(audience, checked === true)}
              />
              <Label htmlFor={`${inputId}-${audience}`}>{scheduleAudienceLabel(audience, t)}</Label>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void apply()}>
            {t("applyAction")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EditableScannableCell({
  checked,
  disabled,
  disabledHint,
  fieldLabel,
  onSave,
}: {
  checked: boolean;
  disabled: boolean;
  disabledHint?: string;
  fieldLabel: string;
  onSave: (next: boolean) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const inputId = useId();
  const [saving, setSaving] = useState(false);

  async function change(next: boolean) {
    setSaving(true);
    try {
      await onSave(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex min-h-8 items-center gap-2 rounded px-1 py-0.5 text-sm"
      title={disabledHint}
    >
      <Checkbox
        id={inputId}
        checked={checked}
        disabled={disabled || saving}
        aria-label={fieldLabel}
        onKeyDown={handleScheduleGridKeyDown}
        onCheckedChange={(next) => void change(next === true)}
        data-schedule-focusable="true"
      />
      <Label htmlFor={inputId}>{checked ? t("yesLabel") : t("noLabel")}</Label>
    </div>
  );
}

export function EditablePublishDateCell({
  value,
  locale,
  fieldLabel,
  onSave,
}: {
  value: string | null;
  locale: string;
  fieldLabel: string;
  onSave: (next: string | null) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => toDatetimeLocal(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(toDatetimeLocal(value));
  }, [value, editing]);

  async function commit(nextDraft = draft): Promise<boolean> {
    if (saving) return false;
    const parsed = nextDraft ? new Date(nextDraft) : null;
    if (parsed && Number.isNaN(parsed.getTime())) return false;
    const next = parsed ? parsed.toISOString() : null;
    if (next === value) {
      setEditing(false);
      return true;
    }
    setSaving(true);
    try {
      const result = await onSave(next);
      const saved = result !== false;
      if (saved) setEditing(false);
      return saved;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        onKeyDown={handleScheduleGridKeyDown}
        data-schedule-focusable="true"
        data-schedule-activate="true"
        className="hover:bg-muted -mx-1 block w-full truncate rounded px-1 py-0.5 text-left"
        aria-label={t("editScheduleFieldAria", { field: fieldLabel })}
      >
        {value ? formatScheduledDateTime(value, locale) : t("notSet")}
      </button>
    );
  }

  return (
    <div
      className="bg-popover border-border absolute inset-y-0 left-0 z-20 flex items-center rounded-md border shadow-md"
      style={{ width: "max(100%, 15rem)" }}
    >
      <DateTimeInput
        value={draft}
        onChange={setDraft}
        onBlur={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          void commit(next);
        }}
        onClear={() => void commit("")}
        onKeyDown={(event) => {
          if (editingNavigationDirection(event)) {
            void commitAndNavigate(event, () => commit(event.currentTarget.value));
            return;
          }
          const input = event.currentTarget;
          if (event.key === "Enter") {
            event.preventDefault();
            void commit(input.value).then(() => refocusScheduleCell(input));
          } else if (event.key === "Escape") {
            setDraft(toDatetimeLocal(value));
            setEditing(false);
            refocusScheduleCell(input);
          }
        }}
        disabled={saving}
        aria-label={fieldLabel}
        data-schedule-focusable="true"
        className="h-7 border-0 bg-transparent shadow-none"
      />
    </div>
  );
}

/** Responsible-person editor (H59), a compact popover version of the schedule editor's OwnersField. */
export function EditableOwnersCell({
  item,
  onUpdate,
}: {
  item: PublicScheduleItem;
  onUpdate: (patch: Partial<PublicScheduleItem>) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [freeTextName, setFreeTextName] = useState("");
  const [busy, setBusy] = useState(false);
  const owners = item.owners ?? [];

  const ownerUserIds = new Set(owners.flatMap((o) => (o.userId ? [o.userId] : [])));
  async function searchAvailableUsers(query: string): Promise<UserOption[]> {
    try {
      const r = await logisticsApi.scheduleOwnerCandidates(query);
      return r.users.filter((u) => !ownerUserIds.has(u.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) toast.error(t("needScheduleManageSearch"));
      else toast.error(t("searchFailed"));
      return [];
    }
  }

  async function refresh() {
    const r = await logisticsApi.scheduleOwners(item.id);
    onUpdate({ owners: r.owners });
  }

  async function add(input: { userId: number } | { freeTextName: string }) {
    setBusy(true);
    try {
      await logisticsApi.addScheduleOwner(item.id, input);
      setSelectedUserId("");
      setFreeTextName("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(ownerId: number) {
    setBusy(true);
    try {
      await logisticsApi.removeScheduleOwner(item.id, ownerId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hover:bg-muted -mx-1 block w-full truncate rounded px-1 py-0.5 text-left"
          onKeyDown={handleScheduleGridKeyDown}
          data-schedule-focusable="true"
          data-schedule-activate="true"
        >
          {ownerNames(item) || <span className="text-muted-foreground">{t("noOwnersYet")}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <UserPicker
            value={selectedUserId}
            onChange={setSelectedUserId}
            search={searchAvailableUsers}
            minQueryLength={2}
            inDialog
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !selectedUserId}
            onClick={() => add({ userId: Number(selectedUserId) })}
          >
            {t("addAction")}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={freeTextName}
            onChange={(e) => setFreeTextName(e.target.value)}
            placeholder={t("ownerFreeTextPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (freeTextName.trim()) add({ freeTextName: freeTextName.trim() });
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !freeTextName.trim()}
            onClick={() => add({ freeTextName: freeTextName.trim() })}
          >
            {t("addAction")}
          </Button>
        </div>
        {owners.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noOwnersYet")}</p>
        ) : (
          <ul className="space-y-1">
            {owners.map((owner) => (
              <li key={owner.id} className="flex items-center justify-between gap-2 text-sm">
                {ownerDisplayName(owner) || t("noOwnersYet")}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={t("remove")}
                  disabled={busy}
                  onClick={() => remove(owner.id)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
