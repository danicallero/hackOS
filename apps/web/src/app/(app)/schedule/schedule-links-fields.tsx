"use client";

// Speakers and linked companies of a schedule item (H48/H59): both are
// replace-all lists sent with the item itself, so they work the same in
// create and edit mode.

import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useState } from "react";
import { DragHandle, SortableItem } from "@/components/common/drag-handle";
import { IconButton } from "@/components/common/icon-button";
import { MultiSelect } from "@/components/common/multi-select";
import { useSortableSensors } from "@/components/common/use-sortable-sensors";
import { UserAvatar } from "@/components/common/user-avatar";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type ScheduleSpeaker } from "@/lib/logistics";
import { listEnterprises } from "@/lib/queue";
import { toast } from "@/lib/toast";
import type { EnterpriseSummary } from "@/lib/types";

export function ScheduleLinksFields({
  speakerUserIds,
  enterpriseIds,
  initialSpeakers,
  onChange,
}: {
  speakerUserIds: number[];
  enterpriseIds: number[];
  /** Display data for speakers already on the item. */
  initialSpeakers: ScheduleSpeaker[];
  onChange: (next: { speakerUserIds?: number[]; enterpriseIds?: number[] }) => void;
}) {
  const { t } = useLocale();
  const [picked, setPicked] = useState<Record<number, { name: string; avatarUrl: string | null }>>(
    () => Object.fromEntries(initialSpeakers.map((s) => [s.userId, s])),
  );
  const sensors = useSortableSensors();
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    listEnterprises()
      .then((list) => {
        if (!cancelled) setEnterprises(list);
      })
      .catch(() => {
        if (!cancelled) setEnterprises([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function searchUsers(query: string): Promise<UserOption[]> {
    try {
      const r = await logisticsApi.scheduleOwnerCandidates(query);
      return r.users.filter((u) => !speakerUserIds.includes(u.id));
    } catch {
      toast.error(t("searchFailed"), t("toastFindUsers"));
      return [];
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= speakerUserIds.length) return;
    const next = [...speakerUserIds];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange({ speakerUserIds: next });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    move(speakerUserIds.indexOf(Number(active.id)), speakerUserIds.indexOf(Number(over.id)));
  }

  return (
    <>
      <div className="space-y-2">
        <p className="flex items-baseline gap-2 text-sm font-medium">
          {t("scheduleSpeakersLabel")}
          {speakerUserIds.length > 0 && (
            <span className="font-normal text-muted-foreground tabular-nums">
              {speakerUserIds.length}
            </span>
          )}
        </p>
        {/* Remount after each pick: UserPicker keeps its chosen user as the trigger label. */}
        <UserPicker
          key={speakerUserIds.length}
          inDialog
          value=""
          search={searchUsers}
          placeholder={t("scheduleSpeakerPlaceholder")}
          onChange={(_, user) => {
            if (!user || speakerUserIds.includes(user.id)) return;
            const name = [user.name, user.surname].filter(Boolean).join(" ").trim() || user.email;
            setPicked((p) => ({ ...p, [user.id]: { name, avatarUrl: null } }));
            onChange({ speakerUserIds: [...speakerUserIds, user.id] });
          }}
        />
        {speakerUserIds.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={speakerUserIds.map(String)}
              strategy={verticalListSortingStrategy}
            >
              {/* Bounded: a ceremony can have ~15 speakers; the list scrolls instead of growing the modal. */}
              <ul
                aria-label={t("scheduleSpeakersLabel")}
                className="max-h-64 divide-y overflow-y-auto rounded-control border px-2"
              >
                {speakerUserIds.map((id, index) => {
                  const speaker = picked[id];
                  const name = speaker?.name ?? String(id);
                  return (
                    <li key={id}>
                      <SortableItem id={String(id)}>
                        {({ attributes, listeners }) => (
                          <div className="flex items-center gap-1 py-1">
                            <DragHandle
                              attributes={attributes}
                              listeners={listeners}
                              label={t("dragToReorderAria", { name })}
                            />
                            <UserAvatar
                              name={name}
                              image={speaker?.avatarUrl}
                              className="size-6"
                              fallbackClassName="text-[0.625rem]"
                              showInitials
                              decorative
                            />
                            <span className="min-w-0 flex-1 truncate px-1 text-sm">{name}</span>
                            <IconButton
                              label={`${t("moveUp")}: ${name}`}
                              size="icon-sm"
                              variant="ghost"
                              disabled={index === 0}
                              onClick={() => move(index, index - 1)}
                            >
                              <ArrowUpIcon className="size-4" />
                            </IconButton>
                            <IconButton
                              label={`${t("moveDown")}: ${name}`}
                              size="icon-sm"
                              variant="ghost"
                              disabled={index === speakerUserIds.length - 1}
                              onClick={() => move(index, index + 1)}
                            >
                              <ArrowDownIcon className="size-4" />
                            </IconButton>
                            <IconButton
                              label={`${t("removeSpeakerAria")}: ${name}`}
                              size="icon-sm"
                              variant="ghost"
                              onClick={() =>
                                onChange({ speakerUserIds: speakerUserIds.filter((x) => x !== id) })
                              }
                            >
                              <XIcon className="size-4" />
                            </IconButton>
                          </div>
                        )}
                      </SortableItem>
                    </li>
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium" id="schedule-companies-label">
          {t("scheduleCompaniesLabel")}
        </p>
        <MultiSelect
          id="schedule-companies"
          inDialog
          aria-labelledby="schedule-companies-label"
          placeholder={t("scheduleCompaniesPlaceholder")}
          searchPlaceholder={t("scheduleCompaniesSearch")}
          options={enterprises.map((e) => ({ value: String(e.id), label: e.name }))}
          value={enterpriseIds.map(String)}
          onChange={(next) => onChange({ enterpriseIds: next.map(Number) })}
        />
      </div>
    </>
  );
}
