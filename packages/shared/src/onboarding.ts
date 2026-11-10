import { CAPABILITIES } from "@hackos/shared/capabilities";

/** HackUDC 2027 onboarding: event-scoped attendance and resumable steps. */
export const MENTOR_PROFILE_CAPABILITY = CAPABILITIES.HELPDESK_OFFER;
export const ATTENDANCE_KINDS = ["participant", "mentor", "sponsor", "staff"] as const;
export type AttendanceKind = (typeof ATTENDANCE_KINDS)[number];
export const ONBOARDING_STEPS = [
  "welcome",
  "profile",
  "dietary",
  "networking",
  "mentor_profile",
  "rsvp",
  "notifications",
  "share",
  "completion",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStatus = "completed" | "skipped" | "deferred" | "declined";
export type OnboardingAction = "complete" | "skip" | "defer" | "decline";
export const ONBOARDING_PROFILE_FIELDS = [
  "name",
  "surname",
  "phone",
  "language",
  "shirtSize",
  "dietary",
  "photo",
] as const;
export type OnboardingStepConfig = {
  enabled: boolean;
  required: boolean;
  kinds: AttendanceKind[];
  reaskOnChange: boolean;
};
export type OnboardingConfig = Partial<Record<OnboardingStep, Partial<OnboardingStepConfig>>> & {
  brand?: { logoUrl?: string; accentColor?: string };
  welcome?: Partial<OnboardingStepConfig> & {
    message?: Partial<Record<"es" | "gl" | "en", string>>;
  };
  profile?: Partial<OnboardingStepConfig> & {
    fields?: (typeof ONBOARDING_PROFILE_FIELDS)[number][];
  };
};
export type OnboardingState = {
  step: OnboardingStep;
  status: OnboardingStatus;
  deferredUntil: string | null;
  configRevision: number;
};
export type OnboardingFacts = {
  attendanceKind: AttendanceKind | null;
  mentorEligible: boolean;
  openRsvps: boolean;
  complete: Partial<Record<OnboardingStep, boolean>>;
};
export type ResolvedOnboardingStep = {
  step: OnboardingStep;
  status: OnboardingStatus | "pending";
  required: boolean;
  deferredUntil: string | null;
  actions: OnboardingAction[];
};

const DEFAULTS: Record<OnboardingStep, OnboardingStepConfig> = {
  welcome: { enabled: true, required: false, kinds: [...ATTENDANCE_KINDS], reaskOnChange: false },
  profile: { enabled: true, required: true, kinds: [...ATTENDANCE_KINDS], reaskOnChange: false },
  dietary: { enabled: true, required: false, kinds: [...ATTENDANCE_KINDS], reaskOnChange: false },
  networking: {
    enabled: true,
    required: false,
    kinds: [...ATTENDANCE_KINDS],
    reaskOnChange: false,
  },
  mentor_profile: {
    enabled: true,
    required: false,
    kinds: [...ATTENDANCE_KINDS],
    reaskOnChange: false,
  },
  rsvp: { enabled: true, required: false, kinds: [...ATTENDANCE_KINDS], reaskOnChange: false },
  notifications: {
    enabled: true,
    required: false,
    kinds: [...ATTENDANCE_KINDS],
    reaskOnChange: false,
  },
  share: { enabled: true, required: false, kinds: [...ATTENDANCE_KINDS], reaskOnChange: false },
  completion: {
    enabled: true,
    required: false,
    kinds: [...ATTENDANCE_KINDS],
    reaskOnChange: false,
  },
};

export function resolveOnboarding(
  config: OnboardingConfig,
  revision: number,
  states: OnboardingState[],
  facts: OnboardingFacts,
  now: Date = new Date(),
): ResolvedOnboardingStep[] {
  const byStep = new Map(states.map((state) => [state.step, state]));
  return ONBOARDING_STEPS.flatMap((step) => {
    const settings = { ...DEFAULTS[step], ...config[step] };
    // Networking consent is always a choice; configuration cannot make it mandatory.
    if (step === "networking") settings.required = false;
    if (
      !settings.enabled ||
      !facts.attendanceKind ||
      !settings.kinds.includes(facts.attendanceKind)
    )
      return [];
    if (step === "mentor_profile" && !facts.mentorEligible) return [];
    if (step === "rsvp" && !facts.openRsvps) return [];
    const state = byStep.get(step);
    const changed = Boolean(state && state.configRevision < revision);
    const pending =
      !state ||
      (state.status === "deferred" &&
        state.deferredUntil !== null &&
        new Date(state.deferredUntil) <= now) ||
      (state.status === "skipped" && changed) ||
      (state.status === "declined" && settings.required && settings.reaskOnChange && changed) ||
      (state.status === "completed" &&
        (facts.complete[step] === false || (settings.reaskOnChange && changed)));
    return [
      {
        step,
        status: pending ? ("pending" as const) : state.status,
        required: settings.required,
        deferredUntil: pending ? null : state.deferredUntil,
        actions: pending
          ? ([
              "complete",
              "defer",
              ...(settings.required ? [] : ["skip", "decline"]),
            ] as OnboardingAction[])
          : [],
      },
    ];
  });
}
