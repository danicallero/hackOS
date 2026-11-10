"use client";

import { CateringRsvpSection } from "@/components/onboarding/catering-rsvp";
import { StepAlternatives, type StepProps } from "@/components/onboarding/onboarding-steps";
import { Button } from "@/components/ui/button";
import { useRsvps } from "@/hooks/use-rsvps";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/**
 * The RSVP step: the same attendee editor as My profile, with Later / Skip /
 * Continue beside its Save. The server only lists this step for people with open
 * RSVPs (a participant is never offered a meal), so there is no client-side kind
 * logic. Saving completes the step; the other decisions follow what the server
 * allows. If the list turns out empty the actions stand alone.
 */
export function RsvpStep(props: StepProps) {
  const { t } = useLocale();
  const { me } = useSessionContext();
  const rsvps = useRsvps(me?.id ?? null);
  if (!me) return null;
  const actions = (
    <>
      <StepAlternatives {...props} />
      <Button
        type="button"
        variant="outline"
        disabled={props.pending}
        onClick={() => props.decide("complete")}
      >
        {t("onboardingContinue")}
      </Button>
    </>
  );
  if (rsvps.items?.length === 0)
    return <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>;
  return (
    <CateringRsvpSection
      userId={me.id}
      onSaved={() => props.decide("complete")}
      actions={actions}
    />
  );
}
