"use client";

import { sponsorShareKey } from "@hackos/shared/applications";
import { SectionCard } from "@/components/common/section-card";
import { TemplateFieldControl } from "@/components/common/template-field-control";
import { groupApplicationFields } from "@/lib/application-field-groups";
import { applicantTimelineState } from "@/lib/application-workflow";
import type { FormSection, TemplateField } from "@/lib/applications";
import { pickText, useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { FieldValue, MyResponseDetail } from "../lib";

export function ApplicationTimeline({ response }: { response: MyResponseDetail | null }) {
  const { t } = useLocale();
  const status = response?.status ?? "draft";
  const timeline = applicantTimelineState(status, response?.submitted_at ?? null);
  const steps = [
    { label: t("timelineApplication"), reached: timeline.application },
    { label: t("dataStatusSubmitted"), reached: timeline.submitted },
    { label: t("review"), reached: timeline.review },
    { label: t("timelineDecision"), reached: timeline.decision },
    { label: t("timelinePlace"), reached: timeline.place },
  ];
  const currentIndex = steps.findIndex((step) => !step.reached);
  const currentStep = currentIndex === -1 ? steps.length - 1 : currentIndex;

  return (
    <SectionCard title={t("applicantTimeline")} bodyClassName="p-4 sm:p-5">
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
    </SectionCard>
  );
}

/** Fallback for older responses without an available immutable form snapshot. */
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

/** The form's questions, grouped under their sections (H12). */
export function ApplicationFields({
  applicationId,
  template,
  sections,
  values,
  fieldErrors,
  disabled,
  onChange,
  onBlur,
}: {
  applicationId: number;
  template: TemplateField[];
  sections: FormSection[];
  values: Record<string, unknown>;
  fieldErrors: Record<string, string | undefined>;
  disabled: boolean;
  onChange: (key: string, value: FieldValue) => void;
  onBlur: (field: TemplateField, value: unknown) => void;
}) {
  const { language } = useLocale();
  return groupApplicationFields(template, sections).map((group, i) => (
    <div
      key={group.section?.key ?? `ungrouped-${i}`}
      className={
        group.section
          ? "border-border bg-muted/20 space-y-4 rounded-lg border p-4 sm:p-5"
          : "space-y-4"
      }
    >
      {group.section && (
        <div className="space-y-0.5">
          <h3 className="type-section-title text-balance">
            {pickText(group.section.title, language)}
          </h3>
          {group.section.description && pickText(group.section.description, language) && (
            <p className="text-muted-foreground text-pretty text-sm">
              {pickText(group.section.description, language)}
            </p>
          )}
        </div>
      )}
      <div className="space-y-4">
        {group.fields.map((field) => (
          <TemplateFieldControl
            key={field.key}
            field={field}
            applicationId={applicationId}
            value={values[field.key] as FieldValue}
            onChange={(v) => onChange(field.key, v)}
            onBlur={(value) => onBlur(field, value)}
            disabled={disabled}
            lang={language}
            error={fieldErrors[field.key]}
            sharedWithSponsors={values[sponsorShareKey(field.key)] === true}
            onSharedWithSponsorsChange={(v) => onChange(sponsorShareKey(field.key), v)}
          />
        ))}
      </div>
    </div>
  ));
}
