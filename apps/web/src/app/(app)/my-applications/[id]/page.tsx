"use client";

// Participant application detail (H12, H15): render one form's template, let the
// owner save a draft, submit it, see the masked status, and — once accepted and
// the decision has been sent — confirm or decline their place.
//
// Endpoints (applicant-only):
//   GET  /api/public/applications/:id          → the open form + template
//   GET  /api/applications/:id/response         → my saved response (404 = none)
//   PUT  /api/applications/:id/response          → create/update my draft
//   POST /api/applications/:id/response/submit   → submit (returns privacy_notice)
//   POST /api/me/responses/:responseId/confirm   → confirm my place (H15)
//   POST /api/me/responses/:responseId/decline   → decline my place (H15)

import { EVENTS } from "@hackos/shared/events";
import {
  CheckCircle2Icon,
  ClipboardListIcon,
  ShieldAlertIcon,
  WalletCardsIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { applicantTimelineState } from "@/app/(app)/applications/workflow";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { TemplateFieldControl } from "@/components/common/template-field-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";
import type { SaveState } from "@/lib/save-state";
import { useMe } from "@/lib/session";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  enrichTemplate,
  type FieldValue,
  fmtDateTime,
  type IntoleranceOption,
  type MyResponseDetail,
  type PublicForm,
  SHIRT_TYPES,
  statusLabel,
  statusTone,
} from "../lib";

/** Extract the per-field errors the API returns on failed template validation. */
function fieldErrorsFromApi(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.details && typeof err.details === "object") {
    const fields = (err.details as { fields?: unknown }).fields;
    if (fields && typeof fields === "object") return fields as Record<string, string>;
  }
  return {};
}

export default function MyApplicationDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const me = useMe();
  const lang: Language = (me?.language as Language) ?? "es";

  const [form, setForm] = useState<PublicForm | null>(null);
  const [response, setResponse] = useState<MyResponseDetail | null>(null);
  const [intolerances, setIntolerances] = useState<IntoleranceOption[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acting, setActing] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");

  // A background live-refresh shouldn't flash the whole page away — only
  // the very first load (before there's anything to show) should.
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    // The public form (template) is only served while the window is open; a
    // closed form 404s but the applicant may still have a response to view. The
    // intolerance dictionary feeds the dietary field for participant/mentor forms.
    const [formRes, respRes, intolRes] = await Promise.allSettled([
      api.get<PublicForm>(`/api/public/applications/${id}`),
      api.get<MyResponseDetail>(`/api/applications/${id}/response`),
      api.get<{ intolerances: IntoleranceOption[] }>("/api/public/food-intolerances"),
    ]);
    const nextForm = formRes.status === "fulfilled" ? formRes.value : null;
    const nextResponse = respRes.status === "fulfilled" ? respRes.value : null;
    setForm(nextForm);
    setResponse(nextResponse);
    setIntolerances(intolRes.status === "fulfilled" ? intolRes.value.intolerances : []);
    // Seed answers from the saved response, then prefill the appended shirt-size
    // and dietary fields from the profile so the applicant doesn't re-enter data
    // the API already knows (H12). Saved values always win over the profile.
    const seeded: Record<string, unknown> = { ...(nextResponse?.responses ?? {}) };
    if (nextForm && SHIRT_TYPES.includes(nextForm.type)) {
      if (seeded.shirt_size == null && me?.shirtSize) seeded.shirt_size = me.shirtSize;
      if (seeded.food_intolerances == null && me?.foodIntolerances?.length) {
        seeded.food_intolerances = me.foodIntolerances.map(String);
      }
      if (seeded.food_intolerance_notes == null && me?.foodIntoleranceNotes) {
        seeded.food_intolerance_notes = me.foodIntoleranceNotes;
      }
    }
    setValues(seeded);
    setSaveState("saved");
    setFieldErrors({});
    // Surface an unexpected error (not a plain 404 "no response / closed form").
    if (
      formRes.status === "rejected" &&
      respRes.status === "rejected" &&
      respRes.reason instanceof ApiError &&
      respRes.reason.status !== 404
    ) {
      toast.error(respRes.reason.message);
    }
    hasLoadedRef.current = true;
    setLoading(false);
  }, [id, me]);

  useEffect(() => {
    load();
  }, [load]);

  // Soft, in-place refresh instead of a hard reload when staff decides on
  // this application elsewhere — but never while the answers are editable,
  // since `load` reseeds `values` from the server and would silently
  // discard an in-progress draft (it's only saved client-side until
  // "Save draft"/submit).
  const editableRef = useRef(false);
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);
  const isFirstLiveRefresh = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (isFirstLiveRefresh.current) {
      isFirstLiveRefresh.current = false;
      return;
    }
    if (editableRef.current) return;
    void load();
  }, [liveRefresh, load]);

  // Mirror the API's enrichment so shirt-size + dietary fields render in the form
  // (participant/mentor) rather than being pulled silently from the profile (H12).
  const template = form ? enrichTemplate(form.type, form.template, intolerances) : [];
  const status = response?.status; // already masked by the API
  // A form is only present here when its window is open, so a draft/new response
  // is editable exactly when we have the template and nothing past 'draft'.
  const editable = !!form && (!response || status === "draft");
  editableRef.current = editable;
  // Accepted + decision sent (the API only unmasks to 'accepted' once sent) means
  // the applicant now holds a confirmation window (H15).
  const canConfirm = status === "accepted";

  function setValue(key: string, value: FieldValue) {
    setSaveState("unsaved");
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function checkRequired(): boolean {
    const errors: Record<string, string> = {};
    for (const f of template) {
      if (!f.required) continue;
      const v = values[f.key];
      const empty =
        v === undefined ||
        v === null ||
        (typeof v === "string" && v.trim() === "") ||
        (Array.isArray(v) && v.length === 0) ||
        (f.kind === "checkbox" && v !== true);
      if (empty) errors[f.key] = t("fieldRequired");
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSaveDraft() {
    setSaving(true);
    setSaveState("saving");
    try {
      const saved = await api.put<MyResponseDetail>(`/api/applications/${id}/response`, {
        responses: values,
      });
      setResponse(saved);
      setValues(saved.responses ?? {});
      setFieldErrors({});
      setSaveState("saved");
      toast.success(t("draftSaved"));
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveDraft"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (!checkRequired()) {
      toast.error(t("fillRequiredFields"));
      return;
    }
    setSubmitting(true);
    setSaveState("saving");
    try {
      // Persist the latest values first so a brand-new response exists to submit.
      await api.put<MyResponseDetail>(`/api/applications/${id}/response`, { responses: values });
      // Sensitive/logistics data lives on the user row. It's now filled in the
      // form itself (enriched fields), so lift shirt size + dietary data from the
      // answers — falling back to the profile if a field wasn't shown (H12).
      const foodIds = Array.isArray(values.food_intolerances)
        ? (values.food_intolerances as string[]).map(Number)
        : (me?.foodIntolerances ?? []);
      const res = await api.post<{ response: MyResponseDetail; privacy_notice: string }>(
        `/api/applications/${id}/response/submit`,
        {
          responses: values,
          food_intolerances: foodIds,
          food_intolerance_notes:
            typeof values.food_intolerance_notes === "string"
              ? values.food_intolerance_notes
              : (me?.foodIntoleranceNotes ?? null),
          shirt_size:
            typeof values.shirt_size === "string" && values.shirt_size
              ? values.shirt_size
              : (me?.shirtSize ?? null),
        },
      );
      setResponse(res.response);
      setValues(res.response.responses ?? {});
      setPrivacyNotice(res.privacy_notice);
      setFieldErrors({});
      setSaveState("saved");
      toast.success(t("applicationSubmitted"));
    } catch (err) {
      setSaveState("error");
      if (err instanceof ApiError) {
        setFieldErrors(fieldErrorsFromApi(err));
        toast.error(err.message);
      } else {
        toast.error(t("couldNotSubmitApplication"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!response) return;
    setActing(true);
    try {
      await api.post(`/api/me/responses/${response.id}/confirm`);
      toast.success(t("placeConfirmedSeeYou"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotConfirmPlace"));
    } finally {
      setActing(false);
    }
  }

  async function handleDecline() {
    if (!response) return;
    setActing(true);
    try {
      await api.post(`/api/me/responses/${response.id}/decline`);
      toast.success(t("placeReleasedMsg"));
      setReleaseOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotReleasePlace"));
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("tabApplication")} />
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      </div>
    );
  }

  // Neither an open form nor an existing response — nothing to show.
  if (!form && !response) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("tabApplication")} />
        <SectionCard title={t("notAvailable")} bodyClassName="p-0">
          <EmptyState
            icon={ClipboardListIcon}
            title={t("applicationNotOpenTitle")}
            description={t("applicationNotOpenDesc")}
            action={
              <Button asChild variant="outline">
                <Link href="/my-applications">{t("backToMyApplications")}</Link>
              </Button>
            }
          />
        </SectionCard>
      </div>
    );
  }

  const title = form?.name ?? t("yourApplicationFallback");

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={form?.description ?? undefined}
        actions={
          status ? (
            <StatusBadge tone={statusTone(status)} dot={false}>
              {statusLabel(status, t)}
            </StatusBadge>
          ) : undefined
        }
      />

      <ApplicationTimeline response={response} />

      {/* Confirm / decline place once accepted (H15). */}
      {canConfirm && (
        <SectionCard
          icon={CheckCircle2Icon}
          title={t("youreInConfirmTitle")}
          description={t("youreInConfirmDesc")}
        >
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>{t("headsUp")}</AlertTitle>
            <AlertDescription>{t("dietaryDataDeletedWarn")}</AlertDescription>
          </Alert>
          {response?.confirmation_expires_at && (
            <p className="text-sm font-medium tabular-nums">
              {t("deadlineLabel", { date: fmtDateTime(response.confirmation_expires_at) })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConfirm} disabled={acting}>
              {acting && <Spinner />}
              {t("confirmPlace")}
            </Button>
            <Button variant="outline" onClick={() => setReleaseOpen(true)} disabled={acting}>
              {t("decline")}
            </Button>
          </div>
        </SectionCard>
      )}

      {status === "confirmed" && (
        <SectionCard
          icon={CheckCircle2Icon}
          title={t("placeConfirmedTitle")}
          description={t("placeConfirmedDesc")}
        >
          <p className="text-muted-foreground text-sm">{t("canReleaseAnytime")}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/wallet">
                <WalletCardsIcon aria-hidden="true" />
                {t("viewTicket")}
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setReleaseOpen(true)} disabled={acting}>
              <XCircleIcon />
              {t("cantAttendRelease")}
            </Button>
          </div>
        </SectionCard>
      )}
      {status === "declined" && (
        <Alert>
          <XCircleIcon />
          <AlertTitle>{t("declinedThisPlaceTitle")}</AlertTitle>
          <AlertDescription>{t("declinedThisPlaceDesc")}</AlertDescription>
        </Alert>
      )}
      {status === "expired" && (
        <Alert>
          <XCircleIcon />
          <AlertTitle>{t("confirmationExpiredTitle")}</AlertTitle>
          <AlertDescription>{t("confirmationExpiredDesc")}</AlertDescription>
        </Alert>
      )}

      {/* The privacy notice returned by submit (H12). */}
      {privacyNotice && (
        <Alert>
          <ShieldAlertIcon />
          <AlertTitle>{t("privacyNoticeTitle")}</AlertTitle>
          <AlertDescription>{privacyNotice}</AlertDescription>
        </Alert>
      )}

      {response?.submitted_at && (
        <Alert>
          <ShieldAlertIcon aria-hidden="true" />
          <AlertTitle>{t("sensitiveDataLifecycleTitle")}</AlertTitle>
          <AlertDescription>
            {status === "confirmed"
              ? t("sensitiveDataLifecycleConfirmed")
              : status === "declined" || status === "expired" || status === "rejected"
                ? t("sensitiveDataLifecycleDeleted")
                : t("sensitiveDataLifecycleSubmitted")}
          </AlertDescription>
        </Alert>
      )}

      <SectionCard
        icon={ClipboardListIcon}
        title={editable ? t("yourAnswers") : t("yourSubmittedAnswers")}
        description={editable ? undefined : t("applicationLockedDesc")}
        footer={
          editable ? (
            <>
              <SaveStatus state={saving || submitting ? "saving" : saveState} className="mr-auto" />
              <Button variant="outline" onClick={handleSaveDraft} disabled={saving || submitting}>
                {saving && <Spinner />}
                {t("saveDraft")}
              </Button>
              <SubmitButton
                type="button"
                onClick={handleSubmit}
                pending={submitting}
                disabled={saving || (me != null && !me.emailVerified)}
              >
                {t("submitApplication")}
              </SubmitButton>
            </>
          ) : undefined
        }
      >
        {editable && me && !me.emailVerified && (
          <Alert variant="destructive">
            <ShieldAlertIcon />
            <AlertTitle>{t("verifyEmailToSubmitTitle")}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {t("verifyEmailToSubmitDesc")}
              <Button asChild size="sm" variant="outline">
                <Link
                  href={withReturnPath(
                    `/verify-email?email=${encodeURIComponent(me.email)}`,
                    `/my-applications/${id}`,
                  )}
                >
                  {t("verifyNow")}
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {template.length > 0 ? (
          template.map((field) => (
            <TemplateFieldControl
              key={field.key}
              field={field}
              applicationId={id}
              value={values[field.key] as FieldValue}
              onChange={(v) => setValue(field.key, v)}
              disabled={!editable}
              lang={lang}
              error={fieldErrors[field.key]}
            />
          ))
        ) : form ? (
          // Open form with no questions — nothing to fill in but a submit is valid.
          <p className="text-muted-foreground text-sm">{t("formHasNoQuestions")}</p>
        ) : (
          // No template available (closed form): show stored answers read-only.
          <ReadOnlyAnswers responses={response?.responses ?? {}} />
        )}
      </SectionCard>

      {response?.submitted_at && (
        <p className="text-muted-foreground text-center text-xs">
          {t("submittedOnPrefix", { date: fmtDateTime(response.submitted_at) })}
        </p>
      )}

      <AlertModal
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        title={t("releaseYourPlace")}
        description={t("releaseYourPlaceDesc")}
        cancelLabel={t("keepMyPlace")}
        confirmLabel={t("yesReleaseMyPlace")}
        destructive
        pending={acting}
        onConfirm={handleDecline}
      >
        <p className="text-muted-foreground text-pretty text-sm">{t("releaseCantBeUndone")}</p>
      </AlertModal>
    </div>
  );
}

function ApplicationTimeline({ response }: { response: MyResponseDetail | null }) {
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
  return (
    <section aria-labelledby="application-timeline-title" className="rounded-lg border p-4">
      <h2 id="application-timeline-title" className="text-balance text-sm font-semibold">
        {t("applicantTimeline")}
      </h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-5">
        {steps.map((step, index) => (
          <li
            key={step.label}
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
function ReadOnlyAnswers({ responses }: { responses: Record<string, unknown> }) {
  const { t } = useLocale();
  const entries = Object.entries(responses);
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("noAnswersSaved")}</p>;
  }
  return (
    <dl className="space-y-3">
      {entries.map(([key, value]) => (
        <div key={key} className="space-y-0.5">
          <dt className="text-muted-foreground text-xs font-medium">{key}</dt>
          <dd className="text-sm">
            {Array.isArray(value) ? value.join(", ") : String(value ?? "—")}
          </dd>
        </div>
      ))}
    </dl>
  );
}
