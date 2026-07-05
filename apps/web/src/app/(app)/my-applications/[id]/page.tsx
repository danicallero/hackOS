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

import { CheckCircle2Icon, ClipboardListIcon, ShieldAlertIcon, XCircleIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { FileUploadField } from "@/components/common/file-upload-field";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { UniversityPicker } from "@/components/common/university-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { pickText } from "@/lib/i18n";
import { useMe } from "@/lib/session";
import type { Language } from "@/lib/types";
import {
  type FieldValue,
  fmtDateTime,
  type MyResponseDetail,
  type PublicForm,
  statusLabel,
  statusTone,
  type TemplateField,
} from "../lib";

const NONE = "__none__";

/** Extract the per-field errors the API returns on failed template validation. */
function fieldErrorsFromApi(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.details && typeof err.details === "object") {
    const fields = (err.details as { fields?: unknown }).fields;
    if (fields && typeof fields === "object") return fields as Record<string, string>;
  }
  return {};
}

export default function MyApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const me = useMe();
  const lang: Language = (me?.language as Language) ?? "es";

  const [form, setForm] = useState<PublicForm | null>(null);
  const [response, setResponse] = useState<MyResponseDetail | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acting, setActing] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // The public form (template) is only served while the window is open; a
    // closed form 404s but the applicant may still have a response to view.
    const [formRes, respRes] = await Promise.allSettled([
      api.get<PublicForm>(`/api/public/applications/${id}`),
      api.get<MyResponseDetail>(`/api/applications/${id}/response`),
    ]);
    const nextForm = formRes.status === "fulfilled" ? formRes.value : null;
    const nextResponse = respRes.status === "fulfilled" ? respRes.value : null;
    setForm(nextForm);
    setResponse(nextResponse);
    setValues(nextResponse?.responses ?? {});
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
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const template = form?.template ?? [];
  const status = response?.status; // already masked by the API
  // A form is only present here when its window is open, so a draft/new response
  // is editable exactly when we have the template and nothing past 'draft'.
  const editable = !!form && (!response || status === "draft");
  // Accepted + decision sent (the API only unmasks to 'accepted' once sent) means
  // the applicant now holds a confirmation window (H15).
  const canConfirm = status === "accepted";

  function setValue(key: string, value: FieldValue) {
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
      if (empty) errors[f.key] = "This field is required";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      const saved = await api.put<MyResponseDetail>(`/api/applications/${id}/response`, {
        responses: values,
      });
      setResponse(saved);
      setValues(saved.responses ?? {});
      setFieldErrors({});
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save your draft.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (!checkRequired()) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSubmitting(true);
    try {
      // Persist the latest values first so a brand-new response exists to submit.
      await api.put<MyResponseDetail>(`/api/applications/${id}/response`, { responses: values });
      // Sensitive/logistics data lives on the user row — pass the profile's
      // current values so submit doesn't blank them (H12).
      const res = await api.post<{ response: MyResponseDetail; privacy_notice: string }>(
        `/api/applications/${id}/response/submit`,
        {
          responses: values,
          food_intolerances: me?.foodIntolerances ?? [],
          food_intolerance_notes: me?.foodIntoleranceNotes ?? null,
          shirt_size: me?.shirtSize ?? null,
        },
      );
      setResponse(res.response);
      setValues(res.response.responses ?? {});
      setPrivacyNotice(res.privacy_notice);
      setFieldErrors({});
      toast.success("Application submitted.");
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(fieldErrorsFromApi(err));
        toast.error(err.message);
      } else {
        toast.error("Could not submit your application.");
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
      toast.success("Your place is confirmed. See you there!");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not confirm your place.");
    } finally {
      setActing(false);
    }
  }

  async function handleDecline() {
    if (!response) return;
    setActing(true);
    try {
      await api.post(`/api/me/responses/${response.id}/decline`);
      toast.success("You've declined your place.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not decline your place.");
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Application" />
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
        <PageHeader title="Application" />
        <SectionCard title="Not available" bodyClassName="p-0">
          <EmptyState
            icon={ClipboardListIcon}
            title="This application isn't open"
            description="The form may have closed or doesn't exist. Head back to see what's open."
            action={
              <Button asChild variant="outline">
                <Link href="/my-applications">Back to my applications</Link>
              </Button>
            }
          />
        </SectionCard>
      </div>
    );
  }

  const title = form?.name ?? "Your application";

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={form?.description ?? undefined}
        actions={
          status ? (
            <StatusBadge tone={statusTone(status)} dot={false}>
              {statusLabel(status)}
            </StatusBadge>
          ) : undefined
        }
      />

      {/* Confirm / decline place once accepted (H15). */}
      {canConfirm && (
        <SectionCard
          icon={CheckCircle2Icon}
          title="You're in — confirm your place"
          description="You've been accepted. Confirm to lock in your spot before the window closes, or decline if you can't make it."
        >
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>
              If you decline (or don't confirm in time), any dietary data you shared is deleted.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConfirm} disabled={acting}>
              {acting && <Spinner />}
              Confirm place
            </Button>
            <Button variant="outline" onClick={handleDecline} disabled={acting}>
              Decline
            </Button>
          </div>
        </SectionCard>
      )}

      {status === "confirmed" && (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Your place is confirmed</AlertTitle>
          <AlertDescription>You're all set. See you at the event!</AlertDescription>
        </Alert>
      )}
      {status === "declined" && (
        <Alert>
          <XCircleIcon />
          <AlertTitle>You declined this place</AlertTitle>
          <AlertDescription>If this was a mistake, contact the organizers.</AlertDescription>
        </Alert>
      )}
      {status === "expired" && (
        <Alert>
          <XCircleIcon />
          <AlertTitle>Your confirmation window expired</AlertTitle>
          <AlertDescription>
            Ask the organization to resend your acceptance if you'd still like to attend.
          </AlertDescription>
        </Alert>
      )}

      {/* The privacy notice returned by submit (H12). */}
      {privacyNotice && (
        <Alert>
          <ShieldAlertIcon />
          <AlertTitle>Privacy notice</AlertTitle>
          <AlertDescription>{privacyNotice}</AlertDescription>
        </Alert>
      )}

      <SectionCard
        icon={ClipboardListIcon}
        title={editable ? "Your answers" : "Your submitted answers"}
        description={
          editable
            ? "Fill in the form below. Save a draft anytime; submit when you're ready."
            : "This application is locked and can no longer be edited."
        }
        footer={
          editable ? (
            <>
              <Button variant="outline" onClick={handleSaveDraft} disabled={saving || submitting}>
                {saving && <Spinner />}
                Save draft
              </Button>
              <SubmitButton
                type="button"
                onClick={handleSubmit}
                pending={submitting}
                disabled={saving}
              >
                Submit application
              </SubmitButton>
            </>
          ) : undefined
        }
      >
        {editable && me && !me.emailVerified && (
          <Alert variant="destructive">
            <ShieldAlertIcon />
            <AlertTitle>Verify your email to submit</AlertTitle>
            <AlertDescription>
              You can save a draft now, but submitting requires a verified email address.
            </AlertDescription>
          </Alert>
        )}

        {template.length > 0 ? (
          template.map((field) => (
            <FieldControl
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
          <p className="text-muted-foreground text-sm">This form has no questions to answer.</p>
        ) : (
          // No template available (closed form): show stored answers read-only.
          <ReadOnlyAnswers responses={response?.responses ?? {}} />
        )}
      </SectionCard>

      {response?.submitted_at && (
        <p className="text-muted-foreground text-center text-xs">
          Submitted {fmtDateTime(response.submitted_at)}
        </p>
      )}
    </div>
  );
}

/** Render a single template field by its kind (H12). */
function FieldControl({
  field,
  applicationId,
  value,
  onChange,
  disabled,
  lang,
  error,
}: {
  field: TemplateField;
  applicationId: number;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  disabled: boolean;
  lang: Language;
  error?: string;
}) {
  const label = pickText(field.label, lang);
  const options = (field.options ?? []).map((o) => ({
    value: o.value,
    label: pickText(o.label, lang),
  }));

  let control: React.ReactNode;
  switch (field.kind) {
    case "textarea":
      control = (
        <Textarea
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "select": {
      const current = typeof value === "string" && value ? value : NONE;
      control = (
        <Select
          value={current}
          onValueChange={(v) => onChange(v === NONE ? "" : v)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {!field.required && <SelectItem value={NONE}>—</SelectItem>}
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    }
    case "multiselect":
      control = (
        <MultiSelect
          options={options}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(v) => onChange(v)}
          disabled={disabled}
        />
      );
      break;
    case "checkbox":
      control = (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value === true}
            onCheckedChange={(c) => onChange(c === true)}
            disabled={disabled}
          />
          <span>{label}</span>
        </label>
      );
      break;
    case "date":
      control = (
        <Input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "number":
      control = (
        <Input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          disabled={disabled}
        />
      );
      break;
    case "file-url":
      control = (
        <Input
          type="url"
          placeholder="https://…"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "file":
      control = (
        <FileUploadField
          applicationId={applicationId}
          fieldKey={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={(url) => onChange(url)}
          allowedTypes={field.allowed_file_types}
          maxSizeMb={field.max_file_size_mb}
          disabled={disabled}
        />
      );
      break;
    case "university":
      // The API stores/validates a university as a numeric id (validateResponses),
      // while the picker works in string ids — convert on the way in and out.
      control = (
        <UniversityPicker
          value={value != null && value !== "" ? String(value) : ""}
          onChange={(v) => onChange(v ? Number(v) : null)}
          disabled={disabled}
        />
      );
      break;
    default:
      control = (
        <Input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
  }

  return (
    <div className="space-y-2">
      {/* The checkbox kind renders its own inline label. */}
      {field.kind !== "checkbox" && (
        <Label>
          {label}
          {field.required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      {control}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

/** Fallback for a closed form whose template we can't fetch: raw stored answers. */
function ReadOnlyAnswers({ responses }: { responses: Record<string, unknown> }) {
  const entries = Object.entries(responses);
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No answers were saved.</p>;
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
