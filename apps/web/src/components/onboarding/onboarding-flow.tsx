"use client";

import type { OnboardingAction, OnboardingStep } from "@hackos/shared/onboarding";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { Spinner } from "@/components/common/spinner";
import {
  CompletionStep,
  MentorStep,
  NetworkingStep,
  NotificationsStep,
  ProfileStep,
  ShareStep,
  STEP_DESCRIPTIONS,
  STEP_TITLES,
  type StepProps,
  WelcomeStep,
} from "@/components/onboarding/onboarding-steps";
import { RsvpStep } from "@/components/onboarding/rsvp-step";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import { pickText, useLocale } from "@/lib/i18n";
import {
  APP_HOME_PATH,
  currentStep,
  decideStep,
  deferUntilTomorrow,
  forPerson,
  markOnboardingOffered,
  type OnboardingState,
  pendingSteps,
  readOnboarding,
} from "@/lib/onboarding";
import { safeReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The resumable onboarding journey. The server resolves every step's status and
 * allowed decisions; this renders one step at a time, persists each answer
 * (complete, skip, defer, decline) and lands on the next open step. Nothing
 * here gates event access: the shell stays reachable and the journey can be left
 * at any point and picked up again from /onboarding.
 */
export function OnboardingFlow() {
  const { t, language } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { me, refresh } = useSessionContext();
  // Where Later and Finish return: the page the person came for, else the app home.
  const leaveTo = safeReturnPath(params.get("next"), APP_HOME_PATH);
  const state = useServerResource(["me", "onboarding"], (signal) => readOnboarding(signal));
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<OnboardingStep | null>(null);
  const moved = useRef(false);
  // Steps still open when the journey was entered: finished ones are not listed again.
  const started = useRef<ReadonlySet<OnboardingStep> | null>(null);
  const [intro, setIntro] = useState(() => params.get("step") === null);

  useEffect(() => {
    if (me) markOnboardingOffered(me.id);
  }, [me]);

  const data = state.data && me ? forPerson(state.data, me) : null;
  const requested = local ?? params.get("step");
  const step = data ? currentStep(data, requested) : null;
  if (data && started.current === null)
    started.current = new Set(pendingSteps(data).map((item) => item.step));
  const nothingOpen = data !== null && pendingSteps(data).length === 0 && !requested;
  useEffect(() => {
    if (nothingOpen) router.replace(leaveTo);
  }, [nothingOpen, router, leaveTo]);

  /** One writer for the step in the URL, guarded so an unchanged value never touches history (R003). */
  const show = useCallback(
    (next: OnboardingStep) => {
      moved.current = true;
      setLocal(next);
      const query = new URLSearchParams(window.location.search);
      if (query.get("step") !== next) {
        // Keep `next` (where Later returns) while the step changes.
        const target = new URLSearchParams({ step: next });
        const back = query.get("next");
        if (back) target.set("next", back);
        router.replace(`/onboarding?${target}`, { scroll: false });
      }
    },
    [router],
  );

  const decide = useCallback(
    async (from: OnboardingStep, action: OnboardingAction) => {
      setBusy(true);
      try {
        // Revisiting a step that was already answered must not be refused: the answer
        // stands, so move on without writing (only declining networking still applies).
        const answered = state.data?.steps.find((item) => item.step === from)?.status;
        const settled =
          (answered === "completed" || answered === "skipped" || answered === "declined") &&
          !(from === "networking" && action === "decline");
        if (!settled)
          await decideStep(from, action, action === "defer" ? deferUntilTomorrow() : undefined);
        const fresh = await readOnboarding();
        state.mutate(fresh);
        void refresh();
        const index = fresh.steps.findIndex((item) => item.step === from);
        const after = fresh.steps.slice(index + 1);
        const next =
          after.find((item) => item.status === "pending") ??
          pendingSteps(fresh)[0] ??
          fresh.steps.find((item) => item.step === "completion");
        if (from === "completion" || !next) router.push(leaveTo);
        else show(next.step);
      } catch (cause) {
        toast.error(apiErrorText(cause, t, t("onboardingCouldNotSave")), {
          compactTitle: t(STEP_TITLES[from]),
        });
      } finally {
        setBusy(false);
      }
    },
    [refresh, router, show, state, t, leaveTo],
  );

  if (state.error)
    return (
      <ContextualError
        message={apiErrorText(state.error, t, t("onboardingCouldNotLoad"))}
        onRetry={state.reload}
      />
    );
  if (!data || !step || nothingOpen) return <Spinner className="size-6" />;

  const props: StepProps = {
    allowed: step.actions,
    pending: busy,
    decide: (action) => void decide(step.step, action),
  };
  const numbered = data.steps.filter(
    (item) =>
      item.step !== "welcome" &&
      item.step !== "completion" &&
      (started.current?.has(item.step) || item.step === step.step),
  );
  const position = numbered.findIndex((item) => item.step === step.step);
  const first = pendingSteps(data).find((item) => item.step !== "completion");
  if (intro && first && first.step !== "welcome" && step.step === first.step)
    return (
      <Intro
        steps={numbered.filter((item) => item.status === "pending")}
        onStart={() => {
          setIntro(false);
          show(first.step);
        }}
        onLater={() => router.push(leaveTo)}
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(STEP_TITLES[step.step])}
        meta={
          position >= 0
            ? t("onboardingStepCount", { current: position + 1, total: numbered.length })
            : undefined
        }
      />
      <ol className="flex flex-wrap gap-2" aria-label={t("onboardingProgress")}>
        {numbered.map((item, index) => {
          const done = item.status === "completed";
          const current = item.step === step.step;
          return (
            <li key={item.step}>
              <button
                type="button"
                onClick={() => show(item.step)}
                aria-current={current ? "step" : undefined}
                aria-label={`${t(STEP_TITLES[item.step])}${done ? ` · ${t("onboardingStatusDone")}` : ""}`}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full border text-sm tabular-nums transition-colors",
                  done && "border-success bg-success text-success-foreground",
                  !done && current && "border-primary bg-primary text-primary-foreground",
                  !done && !current && "text-muted-foreground hover:bg-accent",
                  done && current && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
              >
                {done ? <CheckIcon aria-hidden weight="bold" className="size-4" /> : index + 1}
              </button>
            </li>
          );
        })}
      </ol>
      <section aria-labelledby="onboarding-step">
        <span id="onboarding-step" className="sr-only">
          {t(STEP_TITLES[step.step])}
        </span>
        <StepBody
          language={language}
          step={step.step}
          props={props}
          state={data}
          onOpenStep={show}
        />
      </section>
    </div>
  );
}

function StepBody({
  language,
  step,
  props,
  state,
  onOpenStep,
}: {
  language: Language;
  step: OnboardingStep;
  props: StepProps;
  state: OnboardingState;
  onOpenStep: (step: OnboardingStep) => void;
}) {
  switch (step) {
    case "welcome":
      return <WelcomeStep {...props} message={welcomeText(state, language)} />;
    case "profile":
      return <ProfileStep {...props} part="identity" />;
    case "dietary":
      return <ProfileStep {...props} part="dietary" />;
    case "networking":
      return <NetworkingStep {...props} />;
    case "mentor_profile":
      return <MentorStep {...props} />;
    case "rsvp":
      return <RsvpStep {...props} />;
    case "notifications":
      return <NotificationsStep {...props} />;
    case "share":
      return <ShareStep {...props} />;
    case "completion":
      return <CompletionStep {...props} state={state} onOpenStep={onOpenStep} />;
  }
}

function welcomeText(state: OnboardingState, language: Language): string {
  const message = state.welcomeMessage;
  return message ? pickText({ es: "", gl: "", en: "", ...message }, language) : "";
}

/** Entry page: what is left, before the first step. */
function Intro({
  steps,
  onStart,
  onLater,
}: {
  steps: { step: OnboardingStep }[];
  onStart: () => void;
  onLater: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <PageHeader title={t("onboardingIntroTitle")} meta={t("onboardingIntroSub")} />
      <ol className="divide-y divide-border/60 rounded-surface border">
        {steps.map((item, index) => {
          const description = STEP_DESCRIPTIONS[item.step];
          return (
            <li key={item.step} className="flex items-start gap-3 px-4 py-3">
              <span className="text-muted-foreground w-5 shrink-0 text-sm tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="font-medium">{t(STEP_TITLES[item.step])}</p>
                {description && <p className="text-muted-foreground text-sm">{t(description)}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onLater}>
          {t("onboardingLater")}
        </Button>
        <Button type="button" onClick={onStart}>
          {t("onboardingStart")}
        </Button>
      </div>
    </div>
  );
}
