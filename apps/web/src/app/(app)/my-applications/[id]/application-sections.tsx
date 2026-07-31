"use client";

import { applicantTimelineState } from "@/app/(app)/applications/workflow";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { MyResponseDetail } from "../lib";

export function ApplicationTimeline({ response }: { response: MyResponseDetail | null }) {
  const { t } = useLocale();
  const status = response?.status ?? "draft";
  const timeline = applicantTimelineState(status, response?.submitted_at ?? null);
  const steps = [
    { label: t("timelineApplication"), reached: timeline.application },
    { label: t("dataStatusSubmitted"), reached: timeline.submitted },
    { label: t("timelineReview"), reached: timeline.review },
    { label: t("timelineDecision"), reached: timeline.decision },
    { label: t("timelinePlace"), reached: timeline.place },
  ];
  const currentIndex = steps.findIndex((step) => !step.reached);
  const currentStep = currentIndex === -1 ? steps.length - 1 : currentIndex;

  return (
    <section aria-labelledby="application-timeline-title" className="rounded-lg border p-4">
      <h2 id="application-timeline-title" className="text-balance text-sm font-semibold">
        {t("applicantTimeline")}
      </h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-5">
        {steps.map((step, index) => (
          <li
            key={step.label}
            aria-current={index === currentStep ? "step" : undefined}
            className="flex items-center gap-2 text-sm sm:flex-col sm:gap-1.5 sm:text-center"
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                step.reached
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span className={step.reached ? "font-medium" : "text-muted-foreground"}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Fallback for a closed form whose template we can't fetch: raw stored answers. */
export function ReadOnlyAnswers({ responses }: { responses: Record<string, unknown> }) {
  const { t } = useLocale();
  const entries = Object.entries(responses);
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("noAnswersSaved")}</p>;
  }
  return (
    <dl className="space-y-3">
      {entries.map(([key, value], index) => (
        <div key={key} className="space-y-0.5">
          <dt className="text-muted-foreground text-xs font-medium">
            {t("savedAnswerLabel", { number: index + 1 })}
          </dt>
          <dd className="text-sm">
            {Array.isArray(value) ? value.join(", ") : String(value ?? t("notAvailable"))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
