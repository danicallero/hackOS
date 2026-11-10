"use client";

import type { OnboardingAction, OnboardingStep } from "@hackos/shared/onboarding";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Spinner } from "@/components/common/spinner";
import { Confetti } from "@/components/onboarding/confetti";
import {
  emailChoiceItems,
  initialEmailChoices,
  NotificationChoices,
} from "@/components/onboarding/notification-choices";
import { SocialSharing } from "@/components/onboarding/social-sharing";
import { MentorProfileEditor } from "@/components/profile/mentor-profile-editor";
import { PersonalDetails } from "@/components/profile/personal-details";
import { ProfilePhoto } from "@/components/profile/profile-photo";
import { PublicProfileCard } from "@/components/profile/public-profile-card";
import { WalletSection } from "@/components/profile/wallet-section";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import { formatEventDate } from "@/lib/datetime";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { logisticsApi } from "@/lib/logistics";
import { notificationsApi, type PreferencesResponse } from "@/lib/notifications";
import type { OnboardingState } from "@/lib/onboarding";
import { getPublicEvent } from "@/lib/public-content";
import { useSessionContext } from "@/lib/session";
import type { PublicEvent } from "@/lib/types";

/** What every step receives: the decision callback and which decisions the server allows. */
export interface StepProps {
  allowed: readonly OnboardingAction[];
  pending: boolean;
  /** Persist a decision for this step and move on. */
  decide: (action: OnboardingAction) => void;
}

/** "Later" and "Skip" exactly as the server offers them; a required step shows neither Skip. */
export function StepAlternatives({ allowed, pending, decide }: StepProps) {
  const { t } = useLocale();
  return (
    <>
      {allowed.includes("defer") && (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => decide("defer")}>
          {t("onboardingLater")}
        </Button>
      )}
      {allowed.includes("skip") && (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => decide("skip")}>
          {t("onboardingSkip")}
        </Button>
      )}
    </>
  );
}

export const STEP_TITLES: Record<OnboardingStep, MessageKey> = {
  welcome: "onboardingStepWelcome",
  profile: "onboardingStepProfile",
  dietary: "onboardingStepDietary",
  networking: "onboardingStepNetworking",
  mentor_profile: "onboardingStepMentor",
  rsvp: "onboardingStepRsvp",
  notifications: "onboardingStepNotifications",
  share: "onboardingStepShare",
  completion: "onboardingStepCompletion",
};

/** The public event feed: name, tagline and dates exactly as the organizer configured them. */
export function useEventFacts(): PublicEvent | null {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  useEffect(() => {
    let active = true;
    getPublicEvent()
      .then((value) => active && setEvent(value))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return event;
}

/** "5 Jan 2026" or "5 Jan – 7 Jan 2026", only from configured instants; "" when unset. */
export function eventDateRange(
  event: Pick<PublicEvent, "hackingStartsAt" | "hackingEndsAt" | "timezone"> | null,
  language: "es" | "gl" | "en",
): string {
  if (!event?.hackingStartsAt) return "";
  const start = formatEventDate(event.hackingStartsAt, language, "date", event.timezone);
  const end = event.hackingEndsAt
    ? formatEventDate(event.hackingEndsAt, language, "date", event.timezone)
    : "";
  return end && end !== start ? `${start} – ${end}` : start;
}

export function WelcomeStep({
  decide,
  pending,
  allowed,
  message,
}: StepProps & { message?: string }) {
  const { t, language } = useLocale();
  const event = useEventFacts();
  const dates = eventDateRange(event, language);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="min-w-0 space-y-3">
          {/* biome-ignore lint/performance/noImgElement: static brand wordmark. */}
          <img
            src="/onboarding/hackudc-wordmark.png"
            alt={event?.name ?? ""}
            className="h-10 w-auto max-w-full sm:h-12"
          />
          {event?.tagline && <p className="text-lg text-pretty">{event.tagline}</p>}
          {dates && <p className="text-muted-foreground">{dates}</p>}
          {message && <p className="whitespace-pre-line text-pretty">{message}</p>}
        </div>
        {/* biome-ignore lint/performance/noImgElement: decorative brand art. */}
        <img src="/onboarding/gaviota-flight.png" alt="" className="h-32 w-auto" />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <StepAlternatives
          allowed={allowed.filter((a) => a === "skip")}
          pending={pending}
          decide={decide}
        />
        <Button
          type="button"
          disabled={pending}
          loading={pending}
          onClick={() => decide("complete")}
        >
          {t("onboardingStart")}
        </Button>
      </div>
    </div>
  );
}

/** Continue only while there is nothing to save; with edits the form's Save completes the step. */
function ContinueWhenClean({
  dirty,
  pending,
  decide,
}: {
  dirty: boolean;
  pending: boolean;
  decide: StepProps["decide"];
}) {
  const { t } = useLocale();
  if (dirty) return null;
  return (
    <Button type="button" variant="outline" disabled={pending} onClick={() => decide("complete")}>
      {t("onboardingContinue")}
    </Button>
  );
}

export function ProfileStep(props: StepProps & { part: "identity" | "dietary" }) {
  const { part, decide, pending } = props;
  const [dirty, setDirty] = useState(false);
  return (
    <PersonalDetails
      part={part}
      onDirtyChange={setDirty}
      onSaved={() => decide("complete")}
      actions={
        <>
          <StepAlternatives {...props} />
          <ContinueWhenClean dirty={dirty} pending={pending} decide={decide} />
        </>
      }
    />
  );
}

/** Create, decline and later are three distinct persisted answers; consent is only the explicit create. */
export function NetworkingStep({ decide }: StepProps) {
  const { me } = useSessionContext();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <ProfilePhoto />
        <p className="font-medium">{[me?.name, me?.surname].filter(Boolean).join(" ")}</p>
      </div>
      <PublicProfileCard
        onboarding={{
          onFinished: (choice) => decide(choice === "create" ? "complete" : "decline"),
          onLater: () => decide("defer"),
        }}
      />
    </div>
  );
}

export function MentorStep(props: StepProps) {
  const [dirty, setDirty] = useState(false);
  return (
    <MentorProfileEditor
      onSaved={() => props.decide("complete")}
      onDirtyChange={setDirty}
      actions={
        <>
          <StepAlternatives {...props} />
          <ContinueWhenClean dirty={dirty} pending={props.pending} decide={props.decide} />
        </>
      }
    />
  );
}

export function NotificationsStep(props: StepProps) {
  const { t } = useLocale();
  const { refresh } = useSessionContext();
  const [prefs, setPrefs] = useState<PreferencesResponse | null>(null);
  const [email, setEmail] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries the read.
  useEffect(() => {
    let active = true;
    notificationsApi
      .getPreferences()
      .then((loaded) => {
        if (!active) return;
        setPrefs(loaded);
        setEmail(initialEmailChoices(loaded));
        setError(null);
      })
      .catch(
        (cause) => active && setError(apiErrorText(cause, t, t("couldNotLoadPreferencesToast"))),
      );
    return () => {
      active = false;
    };
  }, [attempt, t]);

  if (!prefs)
    return error ? (
      <ContextualError message={error} onRetry={() => setAttempt((n) => n + 1)} />
    ) : (
      <Spinner className="size-5" />
    );

  async function save() {
    if (!prefs) return;
    setBusy(true);
    setError(null);
    try {
      await notificationsApi.completeOnboarding(emailChoiceItems(prefs, email));
      await refresh();
      props.decide("complete");
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSavePreference")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <NotificationChoices
        prefs={prefs}
        email={email}
        onChange={setEmail}
        pending={busy}
        error={error}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <StepAlternatives {...props} pending={props.pending || busy} />
        <Button type="button" loading={busy} disabled={props.pending} onClick={() => void save()}>
          {t("onboardingContinue")}
        </Button>
      </div>
    </div>
  );
}

export function ShareStep({ decide }: StepProps) {
  const { me } = useSessionContext();
  const { language } = useLocale();
  const event = useEventFacts();
  if (!me || !event?.name) return <Spinner className="size-5" />;
  const year = event.hackingStartsAt
    ? formatEventDate(event.hackingStartsAt, language, "date", event.timezone).slice(-4)
    : "";
  return (
    <div className="space-y-4">
      <SocialSharing
        event={{
          name: event.name,
          year: /^\d{4}$/.test(year) ? year : "",
          dateLabel: eventDateRange(event, language) || undefined,
        }}
        attendee={{
          displayName: [me.name, me.surname].filter(Boolean).join(" "),
          roleLabel: me.visibleRoleName ?? undefined,
          photoUrl: me.image,
        }}
        onContinue={() => decide("complete")}
      />
    </div>
  );
}

/** Where a still-open step can be finished later, so nothing needs to be remembered. */
export function CompletionStep({
  state,
  onOpenStep,
  decide,
  pending,
}: StepProps & { state: OnboardingState; onOpenStep: (step: OnboardingStep) => void }) {
  const { t } = useLocale();
  const { me, isPureApplicant } = useSessionContext();
  // The Wallet block appears only when there is a ticket or badge to add.
  const ticket = useServerResource(["me-ticket"], () => logisticsApi.myTicket());
  const hasPass = Boolean(ticket.data?.ticketToken || ticket.data?.badgeId);
  const open = state.steps.filter(
    (step) =>
      step.step !== "completion" &&
      step.step !== "welcome" &&
      (step.status === "pending" || step.status === "deferred" || step.status === "skipped"),
  );
  return (
    <div className="space-y-6">
      <Confetti />
      <p className="text-lg text-pretty">{t("onboardingCompletionBody")}</p>
      {open.length > 0 && (
        <section aria-labelledby="onboarding-open" className="space-y-2">
          <h2 id="onboarding-open" className="type-label text-muted-foreground">
            {t("onboardingStillOpen")}
          </h2>
          <ul className="divide-y divide-border/60 rounded-surface border">
            {open.map((step) => (
              <li key={step.step} className="flex items-center justify-between gap-3 px-4 py-2">
                <span>{t(STEP_TITLES[step.step])}</span>
                <Button type="button" variant="ghost" onClick={() => onOpenStep(step.step)}>
                  {t("onboardingFinishStep")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {me?.hasEventAccess && !isPureApplicant && hasPass && (
        <section aria-labelledby="onboarding-wallet" className="space-y-3">
          <h2 id="onboarding-wallet" className="type-section-title">
            {t("wallet")}
          </h2>
          <WalletSection />
        </section>
      )}
      <p className="text-muted-foreground text-sm text-pretty">
        {t("onboardingEditLater")}{" "}
        <Link className="underline underline-offset-4" href="/settings/profile">
          {t("myProfile")}
        </Link>
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={pending}
          loading={pending}
          onClick={() => decide("complete")}
        >
          {t("onboardingDone")}
        </Button>
      </div>
    </div>
  );
}
