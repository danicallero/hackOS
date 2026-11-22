"use client";

// Answer to a duplicate-application merge (H13, H54). The proposal email links
// here with #token=… (kept out of URLs and referrers). The page shows the
// merged application and both accounts; the visitor keeps one account (the
// other is deleted) or says the two applications are not theirs. Reading the
// proposal never changes anything; only the buttons POST a decision.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import { type FieldValue, TemplateFieldControl } from "@/components/common/template-field-control";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEmailLinkToken } from "@/hooks/use-email-link-token";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { groupApplicationFields } from "@/lib/application-field-groups";
import type { FormSection, TemplateField } from "@/lib/applications";
import { formatEventDate } from "@/lib/datetime";
import { pickText, useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Side = "first" | "second";

interface MergeView {
  status: string;
  application_name: string;
  you: Side;
  accounts: Array<{ side: Side; email: string }>;
  template: TemplateField[];
  sections: FormSection[];
  answers: Record<string, unknown>;
  submitted_at: string | null;
  expires_at: string | null;
}

type Outcome = { status: "merged"; email: string } | { status: "kept_separate" };

function DuplicateInner() {
  const token = useEmailLinkToken(useSearchParams().get("token"));
  const { t, language } = useLocale();
  const [view, setView] = useState<MergeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keep, setKeep] = useState<Side | null>(null);
  const [pending, setPending] = useState<"merge" | "keep_separate" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  // The link token is read from the fragment after the first render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .post<MergeView>("/api/applications/duplicate-merges/lookup", { token })
      .then((result) => {
        if (!active) return;
        setView(result);
        setKeep(result.you);
      })
      .catch((err) => {
        if (active) setLoadError(apiErrorText(err, t, t("duplicateLoadFailed")));
      });
    return () => {
      active = false;
    };
  }, [token, t]);

  async function answer(decision: "merge" | "keep_separate") {
    if (!token || !view) return;
    setPending(decision);
    setActionError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      await api.post(
        "/api/applications/duplicate-merges/decide",
        { token, decision, ...(decision === "merge" ? { keep } : {}) },
        { headers: { "Idempotency-Key": idempotencyKey.current } },
      );
      setOutcome(
        decision === "merge"
          ? {
              status: "merged",
              email: view.accounts.find((account) => account.side === keep)?.email ?? "",
            }
          : { status: "kept_separate" },
      );
    } catch (err) {
      // A different answer is a different request: never replay this key for it.
      idempotencyKey.current = null;
      setActionError(apiErrorText(err, t, t("duplicateMergeFailed")));
    } finally {
      setPending(null);
    }
  }

  if (outcome) {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <CardTitle>
            {outcome.status === "merged"
              ? t("duplicateMergedTitle")
              : t("duplicateKeptSeparateTitle")}
          </CardTitle>
          {outcome.status === "merged" && (
            <CardDescription>{t("duplicateMergedDesc", { email: outcome.email })}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-center">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/my-applications">{t("viewApplications")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const error = loadError ?? (mounted && !token ? t("apiError_duplicate_merge_invalid") : null);
  if (error) {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <CardTitle>{t("duplicateLinkProblemTitle")}</CardTitle>
          <CardDescription role="alert">{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!view) return <LoadingCard />;

  const fields = view.template.filter((field) => view.answers[field.key] !== undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("duplicateMergeTitle")}</CardTitle>
        <CardDescription>
          {view.application_name}
          {view.submitted_at &&
            ` · ${t("duplicateSubmittedOn", {
              date: formatEventDate(view.submitted_at, language, "dateTime"),
            })}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          {groupApplicationFields(fields, view.sections)
            .filter((group) => group.fields.length > 0)
            .map((group, index) => (
              <div
                key={group.section?.key ?? `ungrouped-${index}`}
                className="border-border space-y-4 border-t pt-5 first:border-t-0 first:pt-0"
              >
                {group.section && (
                  <p className="type-section-title text-balance">
                    {pickText(group.section.title, language)}
                  </p>
                )}
                {group.fields.map((field) =>
                  field.kind === "file" ? (
                    <div key={field.key} className="space-y-1.5">
                      <p className="text-sm font-medium">{pickText(field.label, language)}</p>
                      <p className="text-muted-foreground text-sm break-all">
                        {String(view.answers[field.key])}
                      </p>
                    </div>
                  ) : (
                    <TemplateFieldControl
                      key={field.key}
                      field={field}
                      hideHelpText
                      value={view.answers[field.key] as FieldValue | undefined}
                      disabled
                      onChange={() => undefined}
                      lang={language}
                    />
                  ),
                )}
              </div>
            ))}
        </div>

        <fieldset className="border-border space-y-2 border-t pt-5">
          <legend className="float-left mb-2 w-full text-sm font-medium">
            {t("duplicateKeepAccountLabel")}
          </legend>
          <div className="clear-both grid gap-2">
            {view.accounts.map((account) => (
              <label
                key={account.side}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm",
                  keep === account.side ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <input
                  type="radio"
                  name="keep"
                  className="accent-primary shrink-0"
                  checked={keep === account.side}
                  onChange={() => setKeep(account.side)}
                />
                <span className="min-w-0 break-all">{account.email}</span>
              </label>
            ))}
          </div>
          <p className="text-muted-foreground text-sm">{t("duplicateOtherDeleted")}</p>
        </fieldset>

        {actionError && (
          <p role="alert" className="text-destructive text-sm">
            {actionError}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            disabled={pending !== null}
            loading={pending === "keep_separate"}
            onClick={() => void answer("keep_separate")}
          >
            {t("duplicateKeepSeparateAction")}
          </Button>
          <Button
            disabled={pending !== null || !keep}
            loading={pending === "merge"}
            onClick={() => void answer("merge")}
          >
            {t("duplicateMergeAction")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DuplicateApplicationPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <DuplicateInner />
    </Suspense>
  );
}

function LoadingCard() {
  return (
    <Card aria-busy="true">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Spinner className="size-6" />
      </CardContent>
    </Card>
  );
}
