"use client";

// Speakers and linked companies of a schedule item (H48/H59): both are
// replace-all lists sent with the item itself, so they work the same in
// create and edit mode.

import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { MultiSelect } from "@/components/common/multi-select";
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

  return (
    <>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("scheduleSpeakersLabel")}</p>
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
          <ul className="divide-y">
            {speakerUserIds.map((id) => {
              const speaker = picked[id];
              const name = speaker?.name ?? String(id);
              return (
                <li key={id} className="flex items-center gap-2 py-1.5">
                  <UserAvatar
                    name={name}
                    image={speaker?.avatarUrl}
                    className="size-6"
                    decorative
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                  <IconButton
                    label={t("removeSpeakerAria")}
                    onClick={() =>
                      onChange({ speakerUserIds: speakerUserIds.filter((x) => x !== id) })
                    }
                  >
                    <XIcon className="size-4" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
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
