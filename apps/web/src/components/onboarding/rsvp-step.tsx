"use client";

import { CateringRsvpSection } from "@/components/onboarding/catering-rsvp";
import { StepAlternatives, type StepProps } from "@/components/onboarding/onboarding-steps";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/**
 * The RSVP step: the same attendee editor as My profile. The server only lists
 * this step for people with open RSVPs (a participant is never offered a meal),
 * so there is no client-side kind logic. Saving completes the step; Later and
 * Skip follow the decisions the server allows.
 */
export function RsvpStep(props: StepProps) {
  const { t } = useLocale();
  const { me } = useSessionContext();
  if (!me) return null;
  return (
    <div className="space-y-4">
      <CateringRsvpSection userId={me.id} onSaved={() => props.decide("complete")} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <StepAlternatives {...props} />
        <Button
          type="button"
          variant="outline"
          disabled={props.pending}
          onClick={() => props.decide("complete")}
        >
          {t("onboardingContinue")}
        </Button>
      </div>
    </div>
  );
}
