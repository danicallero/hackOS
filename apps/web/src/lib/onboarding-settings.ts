import {
  ATTENDANCE_KINDS,
  type AttendanceKind,
  ONBOARDING_STEPS,
  type OnboardingConfig,
  type OnboardingStep,
} from "@hackos/shared/onboarding";
import { api } from "./api";
import type { Language } from "./types";

/** GET/PUT /api/event/onboarding (EVENT_MANAGE). */
export interface OnboardingSettingsResponse {
  eventKey: string;
  revision: number;
  config: OnboardingConfig;
}

export interface StepForm {
  enabled: boolean;
  required: boolean;
  kinds: AttendanceKind[];
  reaskOnChange: boolean;
}

export interface SettingsForm {
  steps: Record<OnboardingStep, StepForm>;
  welcomeMessage: Record<Language, string>;
}

/** Mirrors the shared resolver's defaults: every step on for every kind; only the profile is required. */
function defaults(step: OnboardingStep): StepForm {
  return {
    enabled: true,
    required: step === "profile",
    kinds: [...ATTENDANCE_KINDS],
    reaskOnChange: false,
  };
}

export function toForm(config: OnboardingConfig): SettingsForm {
  const steps = Object.fromEntries(
    ONBOARDING_STEPS.map((step) => [step, { ...defaults(step), ...config[step] }]),
  ) as Record<OnboardingStep, StepForm>;
  const message = config.welcome?.message ?? {};
  return {
    steps,
    welcomeMessage: { es: message.es ?? "", gl: message.gl ?? "", en: message.en ?? "" },
  };
}

/** The full config the API stores; a required step is always enabled and networking never required. */
export function toConfig(form: SettingsForm, previous: OnboardingConfig = {}): OnboardingConfig {
  const config: Record<string, unknown> = {};
  for (const step of ONBOARDING_STEPS) {
    const item = form.steps[step];
    const enabled = item.enabled;
    const entry: Record<string, unknown> = {
      enabled,
      required: enabled && step !== "networking" && item.required,
      kinds: [...item.kinds],
      reaskOnChange: item.reaskOnChange,
    };
    if (step === "welcome") {
      const message = Object.fromEntries(
        (["es", "gl", "en"] as const).flatMap((lang) =>
          form.welcomeMessage[lang].trim() ? [[lang, form.welcomeMessage[lang].trim()]] : [],
        ),
      );
      if (Object.keys(message).length) entry.message = message;
    }
    if (step === "profile" && previous.profile?.fields) entry.fields = previous.profile.fields;
    config[step] = entry;
  }
  return config as OnboardingConfig;
}

export const readOnboardingSettings = (signal?: AbortSignal) =>
  api.get<OnboardingSettingsResponse>("/api/event/onboarding", { signal });

export const saveOnboardingSettings = (config: OnboardingConfig) =>
  api.put<OnboardingSettingsResponse | undefined>("/api/event/onboarding", config);
