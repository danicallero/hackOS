"use client";

// Onboarding category: which steps the journey has, who it applies to and what
// is required. It has its own endpoint and save scope (#R011); a step that is
// required can never be switched off, and networking consent never required.

import { ATTENDANCE_KINDS, ONBOARDING_STEPS, type OnboardingStep } from "@hackos/shared/onboarding";
import { useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { STEP_TITLES } from "@/components/onboarding/onboarding-steps";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCategorySaveState } from "@/hooks/use-category-save-state";
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import { languageName, type MessageKey, useLocale } from "@/lib/i18n";
import {
  readOnboardingSettings,
  type SettingsForm,
  saveOnboardingSettings,
  toConfig,
  toForm,
} from "@/lib/onboarding-settings";
import { toast } from "@/lib/toast";
import type { Language } from "@/lib/types";

const KIND_LABELS: Record<(typeof ATTENDANCE_KINDS)[number], MessageKey> = {
  participant: "onboardingKindParticipant",
  mentor: "onboardingKindMentor",
  sponsor: "onboardingKindSponsor",
  staff: "onboardingKindStaff",
};

export function OnboardingTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useLocale();
  const settings = useServerResource(["event", "onboarding"], (signal) =>
    readOnboardingSettings(signal),
  );
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [pending, setPending] = useState(false);
  const stored = settings.data;

  useEffect(() => {
    if (!stored) return;
    const next = toForm(stored.config);
    setForm((current) => current ?? next);
    setBaseline((current) => current || JSON.stringify(next));
  }, [stored]);

  const dirty = form !== null && JSON.stringify(form) !== baseline;
  const [saveState, setSaveState] = useCategorySaveState(dirty, onDirtyChange);

  if (settings.error)
    return (
      <ContextualError
        message={apiErrorText(settings.error, t, t("couldNotLoadEventSettings"))}
        onRetry={settings.reload}
      />
    );
  if (!form || !stored) return <Spinner className="size-5" />;

  function patchStep(step: OnboardingStep, patch: Partial<SettingsForm["steps"][OnboardingStep]>) {
    setForm((current) => {
      if (!current) return current;
      const next = { ...current.steps[step], ...patch };
      if (!next.enabled) next.required = false;
      return { ...current, steps: { ...current.steps, [step]: next } };
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || !stored) return;
    setPending(true);
    setSaveState("saving");
    try {
      await saveOnboardingSettings(toConfig(form, stored.config));
      const fresh = await readOnboardingSettings();
      settings.mutate(fresh);
      const next = toForm(fresh.config);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setSaveState("saved");
      toast.success(t("saved"), { compactTitle: t("onboardingSettingsTitle") });
    } catch (cause) {
      setSaveState("error");
      toast.error(
        apiErrorText(cause, t, t("couldNotSaveEventSettings")),
        t("onboardingSettingsTitle"),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save}>
      <SectionCard
        variant="plain"
        footerClassName="justify-start"
        stickyFooter
        footer={<FormActions pending={pending} state={saveState} disabled={!dirty} />}
      >
        <ol className="divide-y divide-border/60">
          {ONBOARDING_STEPS.map((step) => {
            const item = form.steps[step];
            const id = `onboarding-${step}`;
            return (
              <li key={step} className="space-y-3 py-4 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="type-subheading">{t(STEP_TITLES[step])}</h3>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <ToggleField
                      id={`${id}-enabled`}
                      label={t("onboardingSettingEnabled")}
                      checked={item.enabled}
                      onChange={(enabled) => patchStep(step, { enabled })}
                    />
                    <ToggleField
                      id={`${id}-required`}
                      label={t("onboardingSettingRequired")}
                      checked={item.required}
                      disabled={!item.enabled || step === "networking"}
                      onChange={(required) => patchStep(step, { required })}
                    />
                    <ToggleField
                      id={`${id}-reask`}
                      label={t("onboardingSettingReask")}
                      checked={item.reaskOnChange}
                      disabled={!item.enabled}
                      onChange={(reaskOnChange) => patchStep(step, { reaskOnChange })}
                    />
                  </div>
                </div>
                <fieldset disabled={!item.enabled} className="flex flex-wrap gap-x-6 gap-y-2">
                  <legend className="sr-only">{t("onboardingSettingKinds")}</legend>
                  {ATTENDANCE_KINDS.map((kind) => (
                    <div key={kind} className="flex items-center gap-2">
                      <Checkbox
                        id={`${id}-${kind}`}
                        checked={item.kinds.includes(kind)}
                        onCheckedChange={(checked) =>
                          patchStep(step, {
                            kinds: checked
                              ? ATTENDANCE_KINDS.filter((k) => k === kind || item.kinds.includes(k))
                              : item.kinds.filter((k) => k !== kind),
                          })
                        }
                      />
                      <Label htmlFor={`${id}-${kind}`} className="font-normal">
                        {t(KIND_LABELS[kind])}
                      </Label>
                    </div>
                  ))}
                </fieldset>
                {step === "welcome" && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(["es", "gl", "en"] as Language[]).map((lang) => (
                      <div key={lang} className="space-y-1">
                        <Label htmlFor={`${id}-message-${lang}`}>
                          {t("onboardingWelcomeMessage")} · {languageName(lang)}
                        </Label>
                        <Textarea
                          id={`${id}-message-${lang}`}
                          rows={3}
                          maxLength={1000}
                          value={form.welcomeMessage[lang]}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              welcomeMessage: {
                                ...form.welcomeMessage,
                                [lang]: event.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </SectionCard>
    </form>
  );
}

function ToggleField({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}
