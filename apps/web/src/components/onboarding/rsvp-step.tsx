"use client";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { StepAlternatives, type StepProps } from "./onboarding-steps";

/**
 * TEMPORARY until the catering RSVP component (components/onboarding/catering-rsvp.tsx)
 * is integrated: the step can only be continued or put off.
 */
export function RsvpStep(props: StepProps) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <StepAlternatives {...props} />
      <Button type="button" disabled={props.pending} onClick={() => props.decide("complete")}>
        {t("onboardingContinue")}
      </Button>
    </div>
  );
}
