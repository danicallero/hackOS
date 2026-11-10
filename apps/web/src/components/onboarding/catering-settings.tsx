"use client";

import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { useEffect, useId, useMemo, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { DateTimeInput } from "@/components/common/datetime-input";
import { FormActions } from "@/components/common/form-actions";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useRsvpSettings } from "@/hooks/use-rsvp-settings";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { LANGS, languageName, useLocale } from "@/lib/i18n";
import {
  askableKinds,
  draftToBody,
  RSVP_KIND_LABEL,
  type RsvpSettings,
  type RsvpSettingsDraft,
  type RsvpSummary,
  settingsDraftError,
  settingsToDraft,
} from "@/lib/rsvp";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Organizer RSVP editor for one schedule entry (schedule:manage): enable the
 * RSVP, who is asked, name/description/date overrides and live counts. Answers
 * are always optional. Meals can never ask participants.
 *
 * Integration point for the schedule editor: render
 * `<CateringSettingsPanel scheduleId={item.id} />` for an existing entry. It owns
 * its own Save (the settings are a separate endpoint from the entry itself),
 * so it must not share the entry form's `<form>`; `onDirtyChange` feeds the
 * host's unsaved-changes guard.
 */
export function CateringSettingsPanel({
  scheduleId,
  onDirtyChange,
  onSaved,
}: {
  scheduleId: number;
  onDirtyChange?: (dirty: boolean) => void;
  /** Runs after the settings saved (hosts refresh their own counts). */
  onSaved?: () => void;
}) {
  const { settings, loadError, reload, save } = useRsvpSettings(scheduleId);
  const { t } = useLocale();
  if (loadError && !settings) {
    return <ContextualError message={t("couldNotLoadRsvpSettings")} onRetry={reload} />;
  }
  if (!settings) return null;
  const version = `${settings.activityId}:${JSON.stringify([
    settings.enabled,
    settings.kinds,
    settings.nameI18n,
    settings.descriptionI18n,
    settings.rsvpDate,
    settings.closesAt,
  ])}`;
  return (
    <SettingsForm
      key={version}
      settings={settings}
      save={save}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
    />
  );
}

function SettingsForm({
  settings,
  save,
  onDirtyChange,
  onSaved,
}: {
  settings: RsvpSettings;
  save: (body: unknown) => Promise<RsvpSettings>;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}) {
  const { t } = useLocale();
  const baseId = useId();
  const initial = useMemo(() => settingsToDraft(settings, toDatetimeLocal), [settings]);
  const [draft, setDraft] = useState<RsvpSettingsDraft>(initial);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  const invalid = settingsDraftError(draft);
  const kinds = askableKinds(settings.isMeal);

  useEffect(() => {
    onDirtyChange?.(changed);
    return () => onDirtyChange?.(false);
  }, [changed, onDirtyChange]);

  const patch = (next: Partial<RsvpSettingsDraft>) => setDraft((d) => ({ ...d, ...next }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid || pending) return;
    setSaveError(null);
    setPending(true);
    try {
      await save(draftToBody(draft, fromDatetimeLocal, settings.isMeal));
      toast.success(t("rsvpSettingsSaved"), { compactTitle: t("toastSaveRsvpSettings") });
      onSaved?.();
    } catch {
      const message = t("couldNotSaveRsvpSettings");
      setSaveError(message);
      toast.error(message, t("toastSaveRsvpSettings"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="min-w-0 space-y-5" onSubmit={onSubmit} noValidate>
      {saveError && <ContextualError message={saveError} />}
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${baseId}-enabled`}>{t("rsvpEnabled")}</Label>
        <Switch
          id={`${baseId}-enabled`}
          checked={draft.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </div>

      {draft.enabled && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("rsvpAudience")}</legend>
            <div className="flex flex-wrap gap-2">
              {kinds.map((kind) => {
                const on = draft.kinds.includes(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      patch({
                        kinds: on ? draft.kinds.filter((k) => k !== kind) : [...draft.kinds, kind],
                      })
                    }
                    className={cn(
                      "inline-flex min-h-(--target-min) items-center gap-1.5 rounded-button border px-3 text-sm transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {on && <CheckIcon aria-hidden weight="bold" className="size-3.5" />}
                    {t(RSVP_KIND_LABEL[kind])}
                  </button>
                );
              })}
            </div>
            {settings.isMeal && (
              <p className="text-muted-foreground text-xs">{t("rsvpMealsNoParticipants")}</p>
            )}
          </fieldset>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="-ml-2">
                {t("rsvpCustomize")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-5 pt-3">
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`${baseId}-date`}>{t("rsvpDate")}</Label>
                  <DateTimeInput
                    id={`${baseId}-date`}
                    value={draft.rsvpDate}
                    onChange={(rsvpDate) => patch({ rsvpDate })}
                    nullOption={{ label: t("rsvpUseScheduleDate") }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${baseId}-closes`}>{t("rsvpClosesAt")}</Label>
                  <DateTimeInput
                    id={`${baseId}-closes`}
                    value={draft.closesAt}
                    onChange={(closesAt) => patch({ closesAt })}
                    nullOption={{ label: t("rsvpUseDefaultClose") }}
                  />
                </div>
              </div>

              <LocalizedFields
                baseId={baseId}
                label={t("rsvpName")}
                values={draft.nameI18n}
                placeholder={settings.defaults.name}
                onChange={(nameI18n) => patch({ nameI18n })}
              />
              <LocalizedFields
                baseId={`${baseId}-d`}
                label={t("rsvpDescription")}
                values={draft.descriptionI18n}
                placeholder={settings.defaults.description ?? ""}
                multiline
                onChange={(descriptionI18n) => patch({ descriptionI18n })}
              />
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      {invalid && <p className="text-destructive text-sm">{t(invalid)}</p>}
      <FormActions
        pending={pending}
        disabled={Boolean(invalid)}
        state={saveError ? "error" : changed ? "unsaved" : "saved"}
      />
      {settings.counts && <RsvpCounts counts={settings.counts} />}
    </form>
  );
}

function LocalizedFields({
  baseId,
  label,
  values,
  placeholder,
  multiline = false,
  onChange,
}: {
  baseId: string;
  label: string;
  values: Record<string, string>;
  placeholder: string;
  multiline?: boolean;
  onChange: (values: Record<string, string>) => void;
}) {
  const Field = multiline ? Textarea : Input;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid items-start gap-2 sm:grid-cols-3">
        {LANGS.map((lang) => (
          <Field
            key={lang}
            id={`${baseId}-${lang}`}
            aria-label={`${label} (${languageName(lang)})`}
            placeholder={placeholder}
            value={values[lang] ?? ""}
            onChange={(e) => onChange({ ...values, [lang]: e.target.value })}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Live headcounts for one activity: answers and who is still missing. */
export function RsvpCounts({ counts }: { counts: RsvpSummary }) {
  const { t } = useLocale();
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
      <Count label={t("rsvpYes")} value={counts.attending} />
      <Count label={t("rsvpNo")} value={counts.notAttending} />
      <Count label={t("rsvpUnsure")} value={counts.unsure} />
      <Count label={t("rsvpUnanswered")} value={counts.unanswered} />
    </dl>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground wrap-anywhere">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
