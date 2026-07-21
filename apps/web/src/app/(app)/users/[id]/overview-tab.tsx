"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { UserIcon } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { isLanguage, LANGS, languageName, pickText, useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { Intolerance, Language, UserDetail } from "@/lib/types";
import { StaffEditForm } from "./staff-edit-form";

export function OverviewTab({
  user,
  intolerances,
  onUpdated,
}: {
  user: UserDetail;
  intolerances: Intolerance[];
  onUpdated: () => Promise<void>;
}) {
  const canWrite = useCan(CAPABILITIES.USERS_WRITE);
  return (
    <div className="space-y-6">
      {canWrite ? (
        <StaffEditForm user={user} intolerances={intolerances} onUpdated={onUpdated} />
      ) : (
        <ReadOnlyOverview user={user} intolerances={intolerances} />
      )}
    </div>
  );
}

function intoleranceNames(ids: number[], dict: Intolerance[], lang: Language): string {
  if (!ids.length) return "";
  const byId = new Map(dict.map((i) => [i.id, i]));
  return ids
    .map((id) => {
      const item = byId.get(id);
      return item ? pickText(item.label, lang) : `#${id}`;
    })
    .join(", ");
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className={empty ? "text-muted-foreground text-sm" : "text-sm"}>{empty ? "—" : value}</dd>
    </div>
  );
}

function ReadOnlyOverview({
  user,
  intolerances,
}: {
  user: UserDetail;
  intolerances: Intolerance[];
}) {
  const { t } = useLocale();
  const lang = (LANGS.includes(user.language as Language) ? user.language : "es") as Language;
  return (
    <SectionCard icon={UserIcon} title={t("profileDetails")} bodyClassName="space-y-4">
      <dl className="space-y-4">
        <Field
          label={t("secondaryEmailLabel")}
          value={
            user.secondaryEmail ? (
              <span className="inline-flex items-center gap-2">
                {user.secondaryEmail}
                <StatusBadge tone={user.secondaryEmailVerified ? "success" : "warning"} dot={false}>
                  {user.secondaryEmailVerified ? t("verified") : t("pendingShort")}
                </StatusBadge>
              </span>
            ) : null
          }
        />
        <Field label={t("phone")} value={user.phone} />
        <Field
          label={t("language")}
          value={isLanguage(user.language) ? languageName(user.language) : user.language}
        />
        <Field label={t("shirtSize")} value={user.shirtSize} />
        <Field
          label={t("foodIntolerances")}
          value={intoleranceNames(user.foodIntolerances, intolerances, lang)}
        />
        <Field label={t("dietaryNotesLabel")} value={user.foodIntoleranceNotes} />
        <Field label="DNI" value={user.dni} />
      </dl>
    </SectionCard>
  );
}
