"use client";

// Duplicate applications (H13, H54). Pairs of responses that look like one
// person applying from two accounts — same DNI, or very similar names or
// email local parts. A reviewer compares a pair and either dismisses it or
// proposes a merge choosing each answer and the submission date to keep. When
// one of the two is already accepted there is nothing to merge: the reviewer
// asks instead whether to delete the other account, or, when both are
// accepted with the same DNI, which account to keep. The applicant answers
// from an emailed link (see /applications/duplicate).

import { sponsorShareKey } from "@hackos/shared/applications";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { useEffect, useMemo, useState } from "react";
import {
  fieldValueText,
  type LibraryNames,
  loadLibraryNames,
} from "@/components/applications/answers-export";
import { AlertModal } from "@/components/common/alert-modal";
import { type Column, DataTable } from "@/components/common/data-table";
import { Modal } from "@/components/common/modal";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { applicationStatusLabel, applicationStatusTone } from "@/lib/application-workflow";
import type { FormSection, TemplateField } from "@/lib/applications";
import { formatEventDate } from "@/lib/datetime";
import { pickText, type Translate, useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { showErrorToast, toast } from "@/lib/toast";
import type { Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

interface DuplicateResponse {
  id: number;
  user_id: number;
  name: string | null;
  email: string;
  status: string;
  submitted_at: string | null;
  dni: string | null;
  responses: Record<string, unknown>;
}

interface Candidate {
  first_response_id: number;
  second_response_id: number;
  reasons: Array<"dni" | "name" | "email">;
  name_similarity: number;
  email_similarity: number;
}

interface DuplicateCase {
  id: number;
  status: "dismissed" | "pending" | "merged" | "removed" | "kept_separate" | "cancelled";
  first_response_id: number | null;
  second_response_id: number | null;
  kept_response_id: number | null;
  outdated: boolean;
  created_at: string;
  resolved_at: string | null;
}

interface Overview {
  responses: DuplicateResponse[];
  candidates: Candidate[];
  cases: DuplicateCase[];
}

/** Answer keys that live on the user row or travel with another answer. */
const HIDDEN_KEYS = new Set(["food_intolerances", "food_intolerance_notes"]);
const SHARE_SUFFIX = sponsorShareKey("");
/** A pair with one of these (or two, same DNI) is resolved by deleting an account. */
const ACCEPTED_STATUSES = new Set(["accepted", "confirmed", "accepted_internal"]);

function caseStatus(row: DuplicateCase, t: Translate): { label: string; tone: Tone } {
  if (row.status === "pending") {
    return row.outdated
      ? { label: t("duplicateStatusOutdated"), tone: "warning" }
      : { label: t("duplicateStatusPending"), tone: "info" };
  }
  const map: Record<Exclude<DuplicateCase["status"], "pending">, { label: string; tone: Tone }> = {
    dismissed: { label: t("duplicateStatusDismissed"), tone: "neutral" },
    merged: { label: t("duplicateStatusMerged"), tone: "success" },
    removed: { label: t("duplicateStatusRemoved"), tone: "success" },
    kept_separate: { label: t("duplicateStatusKeptSeparate"), tone: "neutral" },
    cancelled: { label: t("duplicateStatusCancelled"), tone: "neutral" },
  };
  return map[row.status];
}

function Person({ response, t }: { response: DuplicateResponse | undefined; t: Translate }) {
  if (!response) {
    return <div className="text-muted-foreground text-sm">{t("duplicateDeletedApplication")}</div>;
  }
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="truncate font-medium">{response.name ?? "—"}</div>
      <div className="text-muted-foreground truncate text-xs">{response.email}</div>
    </div>
  );
}

export function DuplicatesTab({
  id,
  template,
  sections,
}: {
  id: number;
  template: TemplateField[] | null;
  sections: FormSection[];
}) {
  const { t, language } = useLocale();
  const canEdit = useCan(CAPABILITIES.APPLICATIONS_EDIT_RESPONSE);
  const { data, error, loading, refetch } = useLiveQuery(
    (signal) => api.get<Overview>(`/api/applications/${id}/duplicates`, { signal }),
    domainScope(SSE_TOPICS.APPLICATIONS),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["applications", id, "duplicates"] },
  );
  const byId = useMemo(
    () => new Map((data?.responses ?? []).map((response) => [response.id, response])),
    [data],
  );
  const [comparing, setComparing] = useState<Candidate | null>(null);
  const [busyCase, setBusyCase] = useState<number | null>(null);

  async function cancelCase(row: DuplicateCase) {
    const title = row.status === "pending" ? t("duplicateWithdraw") : t("duplicateUndoDismiss");
    setBusyCase(row.id);
    try {
      await api.post(`/api/applications/${id}/duplicates/${row.id}/cancel`, undefined, {
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      await refetch();
    } catch (err) {
      showErrorToast(err, title);
    } finally {
      setBusyCase(null);
    }
  }

  const candidateColumns: Column<Candidate>[] = [
    {
      id: "applicants",
      header: t("duplicateApplicantsColumn"),
      cell: (row) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Person response={byId.get(row.first_response_id)} t={t} />
          <Person response={byId.get(row.second_response_id)} t={t} />
        </div>
      ),
    },
    {
      id: "signals",
      width: "w-60",
      header: t("duplicateSignalsColumn"),
      cell: (row) => (
        <ul className="space-y-0.5 text-sm">
          {row.reasons.includes("dni") && <li>{t("duplicateSignalDni")}</li>}
          {row.reasons.includes("name") && (
            <li>{t("duplicateSignalName", { percent: Math.round(row.name_similarity * 100) })}</li>
          )}
          {row.reasons.includes("email") && (
            <li>
              {t("duplicateSignalEmail", { percent: Math.round(row.email_similarity * 100) })}
            </li>
          )}
        </ul>
      ),
    },
  ];

  const caseColumns: Column<DuplicateCase>[] = [
    {
      id: "applicants",
      header: t("duplicateApplicantsColumn"),
      cell: (row) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Person
            response={row.first_response_id ? byId.get(row.first_response_id) : undefined}
            t={t}
          />
          <Person
            response={row.second_response_id ? byId.get(row.second_response_id) : undefined}
            t={t}
          />
        </div>
      ),
    },
    {
      id: "status",
      width: "w-44",
      header: t("statusColumn"),
      cell: (row) => {
        const status = caseStatus(row, t);
        return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
      },
    },
    {
      id: "date",
      width: "w-44",
      align: "right",
      header: t("duplicateDateColumn"),
      sortValue: (row) => row.resolved_at ?? row.created_at,
      cell: (row) => (
        <span className="text-muted-foreground text-sm tabular-nums">
          {formatEventDate(row.resolved_at ?? row.created_at, language, "dateTime") || "—"}
        </span>
      ),
    },
  ];

  const comparePair = comparing
    ? ([byId.get(comparing.first_response_id), byId.get(comparing.second_response_id)] as const)
    : null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="type-subheading">{t("duplicateCandidatesHeading")}</h2>
        <DataTable
          columns={candidateColumns}
          data={data?.candidates ?? []}
          getRowId={(row) => `${row.first_response_id}-${row.second_response_id}`}
          onRowClick={setComparing}
          getRowLabel={(row) =>
            `${t("duplicateCompare")}: ${[row.first_response_id, row.second_response_id]
              .map((responseId) => byId.get(responseId)?.name ?? byId.get(responseId)?.email)
              .join(" · ")}`
          }
          loading={loading && !data}
          error={
            error && !data
              ? {
                  message: apiErrorText(error, t, t("duplicateCouldNotLoad")),
                  onRetry: () => void refetch(),
                }
              : undefined
          }
          empty={{ title: t("duplicateNoneTitle") }}
          pageSize={25}
        />
      </section>

      {(data?.cases.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h2 className="type-subheading">{t("duplicateCasesHeading")}</h2>
          <DataTable
            columns={caseColumns}
            data={data?.cases ?? []}
            getRowId={(row) => String(row.id)}
            rowActions={(row) => {
              if (row.status === "dismissed") {
                return (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyCase === row.id}
                    disabled={busyCase !== null}
                    onClick={() => void cancelCase(row)}
                  >
                    {t("duplicateUndoDismiss")}
                  </Button>
                );
              }
              if (row.status === "pending" && canEdit) {
                return (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyCase === row.id}
                    disabled={busyCase !== null}
                    onClick={() => void cancelCase(row)}
                  >
                    {t("duplicateWithdraw")}
                  </Button>
                );
              }
              return null;
            }}
            pageSize={25}
          />
        </section>
      )}

      {comparing && comparePair?.[0] && comparePair[1] && (
        <CompareModal
          applicationId={id}
          first={comparePair[0]}
          second={comparePair[1]}
          template={template ?? []}
          sections={sections}
          canEdit={canEdit}
          sameDni={comparing.reasons.includes("dni")}
          onClose={() => setComparing(null)}
          onDone={async () => {
            setComparing(null);
            await refetch();
          }}
        />
      )}
    </div>
  );
}

const hasValue = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  value !== "" &&
  !(Array.isArray(value) && value.length === 0);

/** The earliest submitted response, else the first: the default date to keep. */
function defaultSubmission(first: DuplicateResponse, second: DuplicateResponse): number {
  if (first.submitted_at && second.submitted_at) {
    return first.submitted_at <= second.submitted_at ? first.id : second.id;
  }
  return second.submitted_at ? second.id : first.id;
}

function CompareModal({
  applicationId,
  first,
  second,
  template,
  sections,
  canEdit,
  sameDni,
  onClose,
  onDone,
}: {
  applicationId: number;
  first: DuplicateResponse;
  second: DuplicateResponse;
  template: TemplateField[];
  sections: FormSection[];
  canEdit: boolean;
  sameDni: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t, language } = useLocale();
  const [libraries, setLibraries] = useState<LibraryNames | null>(null);
  useEffect(() => {
    let active = true;
    void loadLibraryNames(template, [first.responses, second.responses], language).then((names) => {
      if (active) setLibraries(names);
    });
    return () => {
      active = false;
    };
  }, [template, first.responses, second.responses, language]);

  // Template order (by section), then any answer the current form no longer asks.
  const fields = useMemo(() => {
    const order = new Map(sections.map((section, index) => [section.key, index]));
    const known = [...template].sort(
      (a, b) => (order.get(a.section_key ?? "") ?? -1) - (order.get(b.section_key ?? "") ?? -1),
    );
    const knownKeys = new Set(known.map((field) => field.key));
    const extra = [...new Set([...Object.keys(first.responses), ...Object.keys(second.responses)])]
      .filter((key) => !knownKeys.has(key) && !HIDDEN_KEYS.has(key) && !key.endsWith(SHARE_SUFFIX))
      .map(
        (key): TemplateField => ({
          key,
          label: { es: key, gl: key, en: key },
          kind: "text",
          required: false,
        }),
      );
    return [...known, ...extra].filter(
      (field) =>
        !HIDDEN_KEYS.has(field.key) &&
        (hasValue(first.responses[field.key]) || hasValue(second.responses[field.key])),
    );
  }, [template, sections, first.responses, second.responses]);

  const [sources, setSources] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      fields.map((field) => [
        field.key,
        hasValue(first.responses[field.key]) ? first.id : second.id,
      ]),
    ),
  );
  const [submittedFrom, setSubmittedFrom] = useState(() => defaultSubmission(first, second));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<"dismiss" | "propose" | null>(null);
  // One accepted application cannot be merged into: ask to delete the other account.
  const accepted = [first, second].filter((response) => ACCEPTED_STATUSES.has(response.status));
  // Both accepted: the applicant chooses the account, only for the same DNI.
  const choice = accepted.length === 2 && sameDni;
  const removal = accepted.length === 1 || choice;
  const canPropose = canEdit && (accepted.length < 2 || choice);
  // A removal leaves the kept application as it is: highlight its answers
  // (none when the applicant chooses).
  const keptId = accepted.length === 1 ? accepted[0]?.id : removal ? -1 : undefined;
  const proposeLabel = t(
    choice ? "duplicateProposeChoice" : removal ? "duplicateProposeRemoval" : "duplicatePropose",
  );

  const text = (field: TemplateField, value: unknown) => {
    if (!hasValue(value)) return "—";
    if (field.kind === "file" && typeof value === "string") return value.split("/").pop() ?? value;
    return libraries
      ? fieldValueText(field, value, language, t, libraries) || "—"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  };

  async function dismiss() {
    setPending("dismiss");
    try {
      await api.post(
        `/api/applications/${applicationId}/duplicates/dismiss`,
        { response_ids: [first.id, second.id] },
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      await onDone();
    } catch (err) {
      showErrorToast(err, t("duplicateDismiss"));
    } finally {
      setPending(null);
    }
  }

  async function propose() {
    setPending("propose");
    try {
      await api.post(
        `/api/applications/${applicationId}/duplicates/${removal ? "removals" : "merges"}`,
        removal
          ? { response_ids: [first.id, second.id] }
          : {
              response_ids: [first.id, second.id],
              field_sources: sources,
              submitted_from_response_id: submittedFrom,
            },
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      setConfirmOpen(false);
      toast.success(t("duplicateProposeSent"), { compactTitle: proposeLabel });
      await onDone();
    } catch (err) {
      setConfirmOpen(false);
      showErrorToast(err, proposeLabel);
    } finally {
      setPending(null);
    }
  }

  const anySubmitted = Boolean(first.submitted_at || second.submitted_at);
  const pair = [first, second] as const;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("duplicateCompareTitle")}
      size="xl"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            disabled={pending !== null}
            loading={pending === "dismiss"}
            onClick={() => void dismiss()}
          >
            {t("duplicateDismiss")}
          </Button>
          {canPropose && (
            <Button disabled={pending !== null} onClick={() => setConfirmOpen(true)}>
              {proposeLabel}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {pair.map((response) => (
            <div key={response.id} className="min-w-0 space-y-1.5">
              <Person response={response} t={t} />
              <StatusBadge tone={applicationStatusTone(response.status)}>
                {applicationStatusLabel(response.status, t)}
              </StatusBadge>
            </div>
          ))}
        </div>

        <ChoiceRow
          label={t("duplicateSubmittedRow")}
          name="submitted"
          options={pair.map((response) => ({
            id: response.id,
            text: response.submitted_at
              ? formatEventDate(response.submitted_at, language, "dateTime")
              : t("duplicateNotSubmitted"),
            disabled: anySubmitted && !response.submitted_at,
          }))}
          selected={keptId ?? submittedFrom}
          onSelect={setSubmittedFrom}
          readOnly={!canEdit || removal}
        />

        {fields.map((field) => (
          <ChoiceRow
            key={field.key}
            label={pickText(field.label, language)}
            name={`field-${field.key}`}
            options={pair.map((response) => ({
              id: response.id,
              text: text(field, response.responses[field.key]),
              disabled: !hasValue(response.responses[field.key]),
            }))}
            selected={keptId ?? sources[field.key] ?? first.id}
            onSelect={(responseId) =>
              setSources((current) => ({ ...current, [field.key]: responseId }))
            }
            readOnly={!canEdit || removal}
          />
        ))}
      </div>

      <AlertModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t(
          choice
            ? "duplicateChoiceConfirmTitle"
            : removal
              ? "duplicateRemovalConfirmTitle"
              : "duplicateProposeConfirmTitle",
        )}
        description={t(
          choice
            ? "duplicateChoiceConfirmDesc"
            : removal
              ? "duplicateRemovalConfirmDesc"
              : "duplicateProposeConfirmDesc",
        )}
        cancelLabel={t("cancel")}
        confirmLabel={t("duplicateProposeSend")}
        pending={pending === "propose"}
        onConfirm={() => void propose()}
      />
    </Modal>
  );
}

/**
 * One question of the comparison. Different answers are a choice between the
 * two responses; an identical answer is shown once.
 */
function ChoiceRow({
  label,
  name,
  options,
  selected,
  onSelect,
  readOnly,
}: {
  label: string;
  name: string;
  options: Array<{ id: number; text: string; disabled: boolean }>;
  selected: number;
  onSelect: (id: number) => void;
  readOnly: boolean;
}) {
  const [a, b] = options;
  if (!a || !b) return null;
  const same = a.text === b.text;
  return (
    <fieldset className="border-border space-y-2 border-t pt-4">
      <legend className="text-muted-foreground float-left mb-2 w-full text-xs font-medium">
        {label}
      </legend>
      {same ? (
        <p className="whitespace-pre-wrap break-words text-sm">{a.text}</p>
      ) : (
        <div className="grid clear-both gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const checked = selected === option.id;
            const value = (
              <span className="min-w-0 whitespace-pre-wrap break-words">{option.text}</span>
            );
            const className = cn(
              "flex min-w-0 items-start gap-2 rounded-md border p-2.5 text-sm",
              checked ? "border-primary bg-primary/5" : "border-border",
              option.disabled && "text-muted-foreground",
            );
            // Without edit access the comparison is read-only: no choice to make.
            if (readOnly) {
              return (
                <div key={option.id} className={className}>
                  {value}
                </div>
              );
            }
            return (
              <label
                key={option.id}
                className={cn(className, option.disabled ? "cursor-default" : "cursor-pointer")}
              >
                <input
                  type="radio"
                  name={name}
                  className="accent-primary mt-0.5 shrink-0"
                  checked={checked}
                  disabled={option.disabled}
                  onChange={() => onSelect(option.id)}
                />
                {value}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
