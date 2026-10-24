"use client";

// #1083: the page behind the QR and code printed on an attendance certificate.
// It shows what the organisation issued and links the official PDF.

import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { XCircleIcon } from "@phosphor-icons/react/dist/csr/XCircle";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/common/brand";
import { LanguageSelect } from "@/components/common/language-select";
import { Spinner } from "@/components/common/spinner";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";

interface Verification {
  status: "valid" | "revoked";
  variant: "participation" | "hours" | "activities";
  issuedAt: string;
  issuerName: string | null;
  name: string | null;
  surname: string | null;
  eventName: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  hours: number | null;
}

type State = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; data: Verification };

export default function VerifyCertificatePage() {
  const { t, language } = useLocale();
  const { code } = useParams<{ code: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .get<Verification>(`/api/public/certificates/${encodeURIComponent(code)}`)
      .then((data) => !cancelled && setState({ kind: "ready", data }))
      .catch(() => !cancelled && setState({ kind: "missing" }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const date = (value: string) =>
    new Intl.DateTimeFormat(LOCALE_CODES[language], { dateStyle: "long" }).format(new Date(value));

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-6">
      <header className="flex items-center justify-between gap-2 pb-10">
        <Brand />
        <div className="flex items-center gap-1">
          <LanguageSelect />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-col gap-5" aria-live="polite">
        <h1 className="text-balance text-2xl font-semibold">{t("certificateVerifyTitle")}</h1>
        {state.kind === "loading" ? (
          <div className="grid place-items-center py-16" role="status" aria-busy="true">
            <Spinner className="size-7" />
          </div>
        ) : state.kind === "missing" ? (
          <p className="text-muted-foreground">{t("certificateNotFound")}</p>
        ) : (
          <section className="flex flex-col gap-4">
            <p
              className={`flex items-center gap-2 font-medium ${
                state.data.status === "valid" ? "text-success" : "text-destructive"
              }`}
            >
              {state.data.status === "valid" ? (
                <CheckCircleIcon className="size-5" weight="fill" aria-hidden="true" />
              ) : (
                <XCircleIcon className="size-5" weight="fill" aria-hidden="true" />
              )}
              {state.data.status === "valid"
                ? t("certificateStatusValid")
                : t("certificateStatusRevoked")}
            </p>
            <dl className="grid gap-3 text-sm">
              {state.data.name ? (
                <Row label={t("certificateHolder")}>
                  {[state.data.name, state.data.surname].filter(Boolean).join(" ")}
                </Row>
              ) : null}
              {state.data.eventName ? (
                <Row label={t("certificateEvent")}>
                  {state.data.eventName}
                  {state.data.eventStartsAt && state.data.eventEndsAt
                    ? ` · ${date(state.data.eventStartsAt)} – ${date(state.data.eventEndsAt)}`
                    : ""}
                </Row>
              ) : null}
              {state.data.hours != null ? (
                <Row label={t("certificateHours")}>{state.data.hours}</Row>
              ) : null}
              {state.data.issuerName ? (
                <Row label={t("certificateIssuedBy")}>{state.data.issuerName}</Row>
              ) : null}
              <Row label={t("certificateIssuedOn")}>{date(state.data.issuedAt)}</Row>
            </dl>
            {state.data.status === "valid" ? (
              <Button asChild className="self-start">
                <a
                  href={`${API_URL}/api/public/certificates/${encodeURIComponent(code)}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("certificateViewDocument")}
                </a>
              </Button>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
