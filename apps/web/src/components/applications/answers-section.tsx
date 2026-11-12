"use client";

// The answers, staff notes and all-reviews panels shown inside the review modal.

import { sponsorShareKey } from "@hackos/shared/applications";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type FieldValue, TemplateFieldControl } from "@/components/common/template-field-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { groupApplicationFields } from "@/lib/application-field-groups";
import { LOGISTICS_SECTION_KEY } from "@/lib/application-form";
import {
  type FormSection,
  fmtScore,
  type ResponseRow,
  type ReviewEntry,
  type TemplateField,
} from "@/lib/applications";
import { formatEventDate } from "@/lib/datetime";
import { pickText, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function AnswersSection({
  applicationId,
  editing,
  setEditing,
  editValues,
  setEditValues,
  editErrors,
  onEditFieldChange,
  onEditFieldBlur,
  savingEdit,
  saveEdit,
  answerFields,
  compactView,
  answerSections,
  answerValues,
  response,
  lang,
  onExternalLinkClick,
}: {
  applicationId: number;
  editing: boolean;
  setEditing: (v: boolean) => void;
  editValues: Record<string, unknown>;
  setEditValues: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  editErrors: Record<string, string>;
  onEditFieldChange: (key: string, value: FieldValue) => void;
  onEditFieldBlur: (field: TemplateField, value: FieldValue) => void;
  savingEdit: boolean;
  saveEdit: () => Promise<void>;
  answerFields: TemplateField[];
  /** Read-only summary view: birth years read as ages. */
  compactView: boolean;
  answerSections: FormSection[];
  answerValues: Record<string, unknown>;
  response: ResponseRow;
  lang: Language;
  onExternalLinkClick?: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-4">
      {answerSections.length === 0 && <h3 className="type-subheading">{t("answersLabel")}</h3>}
      {answerFields.length > 0 ? (
        <div className="space-y-4">
          {groupApplicationFields(answerFields, answerSections)
            .filter((group) => group.fields.length > 0)
            .map((group, i) => (
              <div
                key={group.section?.key ?? `ungrouped-${i}`}
                className={
                  group.section
                    ? "border-border space-y-4 border-t pt-5 first:border-t-0 first:pt-0"
                    : "space-y-4"
                }
              >
                {group.section && (
                  <p className="type-section-title text-balance">
                    {pickText(group.section.title, lang)}
                  </p>
                )}
                <div className="space-y-4">
                  {group.fields.map((f) => {
                    const isLogistics = group.section?.key === LOGISTICS_SECTION_KEY;
                    const fieldEditing = editing && !isLogistics;
                    const value = (fieldEditing ? editValues[f.key] : answerValues[f.key]) as
                      | FieldValue
                      | undefined;
                    const birthYear = value as unknown;
                    if (compactView && f.kind === "birth_year" && typeof birthYear === "number") {
                      return (
                        <div key={f.key} className="space-y-1.5">
                          <Label htmlFor={`review-age-${f.key}`}>{t("reviewAgeLabel")}</Label>
                          <Input
                            id={`review-age-${f.key}`}
                            disabled
                            value={t("reviewAgeYears", {
                              count: Math.max(0, new Date().getFullYear() - birthYear),
                            })}
                          />
                        </div>
                      );
                    }
                    return (
                      <TemplateFieldControl
                        key={f.key}
                        field={f}
                        hideHelpText
                        applicationId={fieldEditing ? applicationId : undefined}
                        responseId={fieldEditing ? response.id : undefined}
                        value={value}
                        disabled={!fieldEditing}
                        error={fieldEditing ? editErrors[f.key] : undefined}
                        onChange={(v) => onEditFieldChange(f.key, v)}
                        onBlur={(value) => onEditFieldBlur(f, value)}
                        sharedWithSponsors={
                          (fieldEditing ? editValues : response.responses)[
                            sponsorShareKey(f.key)
                          ] === true
                        }
                        onSharedWithSponsorsChange={(v) =>
                          setEditValues((prev) => ({ ...prev, [sponsorShareKey(f.key)]: v }))
                        }
                        lang={lang}
                        inDialog
                        onExternalLinkClick={onExternalLinkClick}
                      />
                    );
                  })}
                </div>
                {group.section?.key === LOGISTICS_SECTION_KEY && (
                  <Link
                    href={`/users/${response.user_id}`}
                    className="text-primary text-xs underline underline-offset-4"
                  >
                    {t("editInProfileLink")}
                  </Link>
                )}
              </div>
            ))}
          {editing && (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={savingEdit}
                onClick={() => setEditing(false)}
              >
                {t("cancel")}
              </Button>
              <Button size="sm" disabled={savingEdit} onClick={saveEdit} loading={savingEdit}>
                {t("saveAnswers")}
              </Button>
            </div>
          )}
        </div>
      ) : Object.keys(response.responses).length > 0 ? (
        <div className="divide-border divide-y">
          {Object.entries(response.responses).map(([k, v]) => (
            <div key={k} className="py-3 first:pt-0 last:pb-0">
              <p className="text-muted-foreground mb-1 text-xs font-medium">{k}</p>
              <div className="whitespace-pre-wrap text-sm">
                {typeof v === "object" ? JSON.stringify(v) : String(v)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("noAnswersRecorded")}</p>
      )}
    </div>
  );
}

const LANGUAGE_TAGS = { es: "spanishTag", gl: "galicianTag", en: "englishTag" } as const;

/** Optional rejection reason, written in the applicant's language (H14). */
export function RejectionReasonCard({
  reason,
  editable,
  language,
  saving,
  onSave,
}: {
  reason: string;
  editable: boolean;
  language?: string | null;
  saving: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(reason);
  useEffect(() => setValue(reason), [reason]);
  const tag = LANGUAGE_TAGS[(language ?? "en") as keyof typeof LANGUAGE_TAGS] ?? "englishTag";
  if (!editable) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("rejectionReason")}</p>
        <p className="whitespace-pre-line text-sm text-muted-foreground">{reason}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Label htmlFor="rejection-reason" className="text-sm font-medium">
        {t("rejectionReason")}
      </Label>
      <Textarea
        id="rejection-reason"
        rows={2}
        maxLength={1000}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("rejectionReasonPlaceholder", { language: t(tag) })}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          disabled={saving || value.trim() === reason.trim()}
          onClick={() => onSave(value)}
          loading={saving}
        >
          {t("saveReason")}
        </Button>
      </div>
    </div>
  );
}

export function StaffNotesCard({
  staffNotes,
  setStaffNotes,
  savingNotes,
  saveStaffNotes,
}: {
  staffNotes: string;
  setStaffNotes: (v: string) => void;
  savingNotes: boolean;
  saveStaffNotes: () => Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-2">
      <Label htmlFor="review-internal-notes" className="text-sm font-medium">
        {t("internalNotesLabel")}
      </Label>
      <Textarea
        id="review-internal-notes"
        rows={2}
        value={staffNotes}
        onChange={(e) => setStaffNotes(e.target.value)}
        placeholder={t("visibleToAllReviewersPlaceholder")}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          disabled={savingNotes}
          onClick={saveStaffNotes}
          loading={savingNotes}
        >
          {t("saveNotes")}
        </Button>
      </div>
    </div>
  );
}

export function ReviewsPage({
  reviews,
  avgScore,
  reviewCount,
  onBack,
}: {
  reviews: ReviewEntry[];
  avgScore: number | string | null;
  reviewCount: number;
  onBack: () => void;
}) {
  const { t } = useLocale();
  return (
    <section aria-labelledby="all-reviews-title" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button type="button" size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeftIcon aria-hidden="true" />
            {t("backToApplication")}
          </Button>
          <h3 id="all-reviews-title" className="type-section-title mt-3 text-balance">
            {t("allReviewsTitle")}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            avg {fmtScore(avgScore)}/5 · {reviewCount}{" "}
            {reviewCount === 1 ? t("reviewWord") : t("reviewsWord")}
          </p>
        </div>
      </div>
      {reviews.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {reviews.map((review) => (
            <ReviewBubble key={review.author_id} review={review} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("noReviewsYet")}</p>
      )}
    </section>
  );
}

function ReviewBubble({ review }: { review: ReviewEntry }) {
  const { t, language } = useLocale();
  return (
    <li className="border-border bg-muted/20 space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{review.author_name ?? t("unknownReviewer")}</p>
        <div className="flex items-center gap-2">
          {review.score != null && (
            <span className="text-sm font-medium tabular-nums">{review.score}/5</span>
          )}
          <span className="text-muted-foreground text-xs">
            {formatEventDate(review.updated_at, language, "date")}
          </span>
        </div>
      </div>
      {review.notes && (
        <p className="text-muted-foreground text-sm whitespace-pre-wrap">{review.notes}</p>
      )}
    </li>
  );
}
