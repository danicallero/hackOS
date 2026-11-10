"use client";

import type { OnboardingAction, OnboardingStep } from "@hackos/shared/onboarding";
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
  STEP_TITLES,
  type StepProps,
  WelcomeStep,
} from "@/components/onboarding/onboarding-steps";
import { RsvpStep } from "@/components/onboarding/rsvp-step";
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import { pickText, useLocale } from "@/lib/i18n";
import {
  APP_HOME_PATH,
  currentStep,
  decideStep,
  deferUntilTomorrow,
  markOnboardingOffered,
  type OnboardingState,
  pendingSteps,
  readOnboarding,
} from "@/lib/onboarding";
import { useSessionContext } from "@/lib/session";
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
  const state = useServerResource(["me", "onboarding"], (signal) => readOnboarding(signal));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<OnboardingStep | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (me) markOnboardingOffered(me.id);
  }, [me]);

  const data = state.data;
  const requested = local ?? params.get("step");
  const step = data ? currentStep(data, requested) : null;

  /** One writer for the step in the URL, guarded so an unchanged value never touches history (R003). */
  const show = useCallback(
    (next: OnboardingStep) => {
      moved.current = true;
      setLocal(next);
      if (new URLSearchParams(window.location.search).get("step") !== next)
        router.replace(`/onboarding?step=${next}`, { scroll: false });
    },
    [router],
  );

  const decide = useCallback(
    async (from: OnboardingStep, action: OnboardingAction) => {
      setBusy(true);
      setError(null);
      try {
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
        if (from === "completion" || !next) router.push(APP_HOME_PATH);
        else show(next.step);
      } catch (cause) {
        setError(apiErrorText(cause, t, t("onboardingCouldNotSave")));
      } finally {
        setBusy(false);
      }
    },
    [refresh, router, show, state, t],
  );

  if (state.error)
    return (
      <ContextualError
        message={apiErrorText(state.error, t, t("onboardingCouldNotLoad"))}
        onRetry={state.reload}
      />
    );
  if (!data || !step) return data ? <Nothing /> : <Spinner className="size-6" />;

  const props: StepProps = {
    allowed: step.actions,
    pending: busy,
    decide: (action) => void decide(step.step, action),
  };
  const numbered = data.steps.filter(
    (item) => item.step !== "welcome" && item.step !== "completion",
  );
  const position = numbered.findIndex((item) => item.step === step.step);

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
      <div
        role="progressbar"
        aria-label={t("onboardingProgress")}
        aria-valuemin={0}
        aria-valuemax={data.steps.length}
        aria-valuenow={
          Math.max(
            0,
            data.steps.findIndex((item) => item.step === step.step),
          ) + 1
        }
        aria-valuetext={t(STEP_TITLES[step.step])}
        className="flex gap-1"
      >
        {data.steps.map((item) => (
          <span
            key={item.step}
            className={cn(
              "h-1 flex-1 rounded-full",
              item.step === step.step
                ? "bg-primary"
                : item.status === "pending"
                  ? "bg-border"
                  : "bg-primary/40",
            )}
          />
        ))}
      </div>
      {error && <ContextualError message={error} />}
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

function Nothing() {
  const { t } = useLocale();
  return <p className="text-muted-foreground">{t("onboardingNothingToDo")}</p>;
}
