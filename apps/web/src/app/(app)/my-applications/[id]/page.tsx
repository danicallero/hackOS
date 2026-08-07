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
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { TemplateFieldControl, templateFieldId } from "@/components/common/template-field-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";
import type { SaveState } from "@/lib/save-state";
import { useMe } from "@/lib/session";
import type { Language } from "@/lib/types";
import {
  type ActionError,
  enrichTemplate,
  type FieldValue,
  fieldErrorsFromApi,
  fmtDateTime,
  type IntoleranceOption,
  isConfirmationExpiredError,
  isNotFoundError,
  type MutationKey,
  type MyResponseDetail,
  missingRequiredFields,
  type PublicForm,
  SHIRT_TYPES,
  statusLabel,
  statusTone,
} from "../lib";
import { ApplicationTimeline, ReadOnlyAnswers } from "./application-sections";

export default function MyApplicationDetailPage() {
  const { t, language } = useLocale();
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [confirmationExpired, setConfirmationExpired] = useState(false);
  const confirmKeyRef = useRef<MutationKey | null>(null);
  const declineKeyRef = useRef<MutationKey | null>(null);

  // A background live-refresh shouldn't flash the whole page away — only
  // the very first load (before there's anything to show) should.
  const hasLoadedRef = useRef(false);
  const formRef = useRef<PublicForm | null>(null);
  const responseRef = useRef<MyResponseDetail | null>(null);
  const intolerancesRef = useRef<IntoleranceOption[]>([]);

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
    const nextForm = formRes.status === "fulfilled" ? formRes.value : formRef.current;
    const nextResponse = respRes.status === "fulfilled" ? respRes.value : responseRef.current;
    if (formRes.status === "fulfilled") formRef.current = formRes.value;
    else if (isNotFoundError(formRes.reason)) formRef.current = null;
    if (respRes.status === "fulfilled") {
      const previousResponse = responseRef.current;
      responseRef.current = respRes.value;
      if (respRes.value.status === "expired") {
        setConfirmationExpired(true);
      } else if (
        respRes.value.status !== "accepted" ||
        previousResponse?.confirmation_expires_at !== respRes.value.confirmation_expires_at
      ) {
        setConfirmationExpired(false);
      }
    } else if (isNotFoundError(respRes.reason)) {
      responseRef.current = null;
      setConfirmationExpired(false);
    }
    if (intolRes.status === "fulfilled") intolerancesRef.current = intolRes.value.intolerances;

    const nextFormError =
      formRes.status === "rejected" && !isNotFoundError(formRes.reason)
        ? formRes.reason instanceof ApiError
          ? formRes.reason.message
          : t("couldNotLoadApplication")
        : null;
    const nextResponseError =
      respRes.status === "rejected" && !isNotFoundError(respRes.reason)
        ? respRes.reason instanceof ApiError
          ? respRes.reason.message
          : t("couldNotLoadApplication")
        : null;
    const nextIntolerancesError =
      intolRes.status === "rejected"
        ? intolRes.reason instanceof ApiError
          ? intolRes.reason.message
          : t("couldNotLoadApplication")
        : null;
    setFormError(nextFormError);
    setResponseError(nextResponseError);
    setLoadError(
      nextFormError ??
        nextResponseError ??
        (formRef.current || responseRef.current ? nextIntolerancesError : null),
    );
    setForm(formRef.current);
    setResponse(responseRef.current);
    setIntolerances(intolerancesRef.current);
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
    hasLoadedRef.current =
      hasLoadedRef.current ||
      formRes.status === "fulfilled" ||
      respRes.status === "fulfilled" ||
      intolRes.status === "fulfilled";
    setLoading(false);
  }, [id, me, t]);

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
  const status = confirmationExpired ? "expired" : response?.status; // already masked by the API
  const timelineResponse =
    confirmationExpired && response ? { ...response, status: "expired" } : response;
  // A form is only present here when its window is open, so a draft/new response
  // is editable exactly when we have the template and nothing past 'draft'.
  const editable = !!form && !formError && !responseError && (!response || status === "draft");
  editableRef.current = editable;
  // Accepted + decision sent (the API only unmasks to 'accepted' once sent) means
  // the applicant now holds a confirmation window (H15).
  const canConfirm = status === "accepted" && !responseError;

  function setValue(key: string, value: FieldValue) {
    setSaveState("unsaved");
    setActionError(null);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function checkRequired(): boolean {
    const missing = missingRequiredFields(template, values);
    const errors = Object.fromEntries(missing.map((key) => [key, t("fieldRequired")]));
    setFieldErrors(errors);
    const firstInvalid = template.find((field) => errors[field.key]);
    if (firstInvalid) {
      requestAnimationFrame(() => {
        document.getElementById(templateFieldId(firstInvalid.key, id))?.focus();
      });
    }
    return missing.length === 0;
  }

  async function handleSaveDraft() {
    setSaving(true);
    setSaveState("saving");
    setActionError(null);
    try {
      const saved = await api.put<MyResponseDetail>(`/api/applications/${id}/response`, {
        responses: values,
      });
      setResponse(saved);
      setValues(saved.responses ?? {});
      setFieldErrors({});
      setSaveState("saved");
      setActionError(null);
      toast.success(t("draftSaved"));
    } catch (err) {
      setSaveState("error");
      setActionError({
        action: "save",
        message: err instanceof ApiError ? err.message : t("couldNotSaveDraft"),
      });
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
    setActionError(null);
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
      setActionError(null);
      toast.success(t("applicationSubmitted"));
    } catch (err) {
      setSaveState("error");
      setActionError({
        action: "submit",
        message: err instanceof ApiError ? err.message : t("couldNotSubmitApplication"),
      });
      if (err instanceof ApiError) {
        const nextErrors = fieldErrorsFromApi(err, t);
        setFieldErrors(nextErrors);
        const firstInvalid = template.find((field) => nextErrors[field.key]);
        if (firstInvalid) {
          requestAnimationFrame(() => {
            document.getElementById(templateFieldId(firstInvalid.key, id))?.focus();
          });
        }
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
    setActionError(null);
    try {
      if (
        !confirmKeyRef.current ||
        confirmKeyRef.current.responseId !== response.id ||
        confirmKeyRef.current.status !== response.status
      ) {
        confirmKeyRef.current = {
          responseId: response.id,
          status: response.status,
          key: crypto.randomUUID(),
        };
      }
      await api.post(`/api/me/responses/${response.id}/confirm`, undefined, {
        headers: { "Idempotency-Key": confirmKeyRef.current.key },
      });
      toast.success(t("placeConfirmedSeeYou"));
      await load();
    } catch (err) {
      if (isConfirmationExpiredError(err)) {
        setConfirmationExpired(true);
        await load();
      } else {
        setActionError({
          action: "confirm",
          message: err instanceof ApiError ? err.message : t("couldNotConfirmPlace"),
        });
      }
    } finally {
      setActing(false);
    }
  }

  async function handleDecline() {
    if (!response) return;
    setActing(true);
    setActionError(null);
    try {
      if (
        !declineKeyRef.current ||
        declineKeyRef.current.responseId !== response.id ||
        declineKeyRef.current.status !== response.status
      ) {
        declineKeyRef.current = {
          responseId: response.id,
          status: response.status,
          key: crypto.randomUUID(),
        };
      }
      await api.post(`/api/me/responses/${response.id}/decline`, undefined, {
        headers: { "Idempotency-Key": declineKeyRef.current.key },
      });
      toast.success(t("placeReleasedMsg"));
      setReleaseOpen(false);
      await load();
    } catch (err) {
      setActionError({
        action: "decline",
        message: err instanceof ApiError ? err.message : t("couldNotReleasePlace"),
      });
    } finally {
      setActing(false);
    }
  }

  function retryAction() {
    if (!actionError) return;
    if (actionError.action === "save") return void handleSaveDraft();
    if (actionError.action === "submit") return void handleSubmit();
    if (actionError.action === "confirm") return void handleConfirm();
    return void handleDecline();
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title={t("tabApplication")} />
        <div role="status" className="space-y-4">
          <span className="sr-only">{t("loading")}</span>
          <div className="h-5 w-2/3 max-w-md animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-28 animate-pulse rounded-lg border bg-muted/50 motion-reduce:animate-none" />
          <div className="h-52 animate-pulse rounded-lg border bg-muted/50 motion-reduce:animate-none" />
        </div>
      </div>
    );
  }

  const retry = () => void load();

  // Neither an open form nor an existing response — nothing to show.
  if (!form && !response) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("tabApplication")} />
        {loadError ? (
          <ContextualError message={loadError} onRetry={retry} />
        ) : (
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
        )}
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

      {loadError && <ContextualError message={loadError} onRetry={retry} />}

      <ApplicationTimeline response={timelineResponse} />

      {/* Confirm / decline place once accepted (H15). */}
      {canConfirm && (
        <SectionCard
          icon={CheckCircle2Icon}
          title={t("youreInConfirmTitle")}
          description={t("youreInConfirmDesc")}
        >
          <Alert role="status">
            <ShieldAlertIcon aria-hidden="true" />
            <AlertTitle>{t("headsUp")}</AlertTitle>
            <AlertDescription>{t("dietaryDataDeletedWarn")}</AlertDescription>
          </Alert>
          {response?.confirmation_expires_at && (
            <p className="text-sm font-medium tabular-nums">
              {t("deadlineLabel", {
                date: fmtDateTime(response.confirmation_expires_at, language),
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConfirm} disabled={acting} className="w-full sm:w-auto">
              {acting && <Spinner />}
              {t("confirmPlace")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setReleaseOpen(true)}
              disabled={acting}
              className="w-full sm:w-auto"
            >
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
            <Button
              variant="outline"
              onClick={() => setReleaseOpen(true)}
              disabled={acting}
              className="w-full sm:w-auto"
            >
              <XCircleIcon aria-hidden="true" />
              {t("cantAttendRelease")}
            </Button>
          </div>
        </SectionCard>
      )}
      {actionError && (actionError.action === "confirm" || actionError.action === "decline") && (
        <ContextualError message={actionError.message} onRetry={retryAction} />
      )}
      {status === "declined" && (
        <Alert role="status">
          <XCircleIcon aria-hidden="true" />
          <AlertTitle>{t("declinedThisPlaceTitle")}</AlertTitle>
          <AlertDescription>{t("declinedThisPlaceDesc")}</AlertDescription>
        </Alert>
      )}
      {status === "expired" && (
        <Alert role="status">
          <XCircleIcon aria-hidden="true" />
          <AlertTitle>{t("confirmationExpiredTitle")}</AlertTitle>
          <AlertDescription>{t("confirmationExpiredDesc")}</AlertDescription>
        </Alert>
      )}

      {/* The privacy notice returned by submit (H12). */}
      {privacyNotice && (
        <Alert role="status">
          <ShieldAlertIcon aria-hidden="true" />
          <AlertTitle>{t("privacyNoticeTitle")}</AlertTitle>
          <AlertDescription>{privacyNotice}</AlertDescription>
        </Alert>
      )}

      {response?.submitted_at && (
        <Alert role="status">
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
            <div className="flex w-full flex-wrap items-center gap-2">
              <SaveStatus state={saving || submitting ? "saving" : saveState} className="mr-auto" />
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveDraft}
                disabled={saving || submitting}
                className="w-full sm:w-auto"
              >
                {saving && <Spinner />}
                {t("saveDraft")}
              </Button>
              <SubmitButton
                type="button"
                onClick={handleSubmit}
                pending={submitting}
                disabled={saving || me?.emailVerified !== true}
                aria-describedby={
                  me?.emailVerified === true ? undefined : `verify-email-to-submit-${id}`
                }
                className="w-full sm:w-auto"
              >
                {t("submitApplication")}
              </SubmitButton>
            </div>
          ) : undefined
        }
      >
        {actionError && (actionError.action === "save" || actionError.action === "submit") && (
          <ContextualError message={actionError.message} onRetry={retryAction} />
        )}
        {editable && me && !me.emailVerified && (
          <Alert id={`verify-email-to-submit-${id}`} variant="destructive">
            <ShieldAlertIcon aria-hidden="true" />
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
          {t("submittedOnPrefix", { date: fmtDateTime(response.submitted_at, language) })}
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
