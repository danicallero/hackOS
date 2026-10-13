"use client";

// Company tag link fallback (#935): `https://<web host>/s/<code>` is what NFC
// tags and printed QR codes carry. Phones with the app open it there; any
// other browser lands here. Signed in, the tag is collected through the same
// diary scan as the app; signed out, the page offers sign-in and returns here.

import { StorefrontIcon } from "@phosphor-icons/react/dist/csr/Storefront";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/common/brand";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";
import { collectErrorKey, type ScanResult } from "./collect";

type State =
  | { status: "collecting" }
  | { status: "collected"; result: ScanResult }
  | { status: "error"; key: MessageKey | null; text: string };

export default function CompanyTagPage() {
  const { t } = useLocale();
  const { code } = useParams<{ code: string }>();
  const { status } = useSessionContext();
  const [state, setState] = useState<State>({ status: "collecting" });
  const started = useRef<string | null>(null);
  const path = `/s/${encodeURIComponent(code)}`;

  useEffect(() => {
    if (status !== "authenticated" || started.current === code) return;
    started.current = code;
    setState({ status: "collecting" });
    api
      .post<ScanResult>("/api/me/diary/scan", { code })
      .then((result) => {
        if (started.current === code) setState({ status: "collected", result });
      })
      .catch((err: unknown) => {
        if (started.current !== code) return;
        setState({
          status: "error",
          key: collectErrorKey(err),
          text: apiErrorText(err, t, ""),
        });
      });
  }, [status, code, t]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-6">
      <header className="flex items-center justify-between gap-4 pb-10">
        <Brand />
        <ThemeToggle />
      </header>

      <section className="flex flex-1 flex-col items-center gap-5 text-center" aria-live="polite">
        {status === "loading" || (status === "authenticated" && state.status === "collecting") ? (
          <div className="grid place-items-center py-24" role="status" aria-busy="true">
            <Spinner className="size-7" />
            <span className="sr-only">{t("companyTagCollecting")}</span>
          </div>
        ) : status === "unauthenticated" ? (
          <>
            <div className="bg-muted grid size-24 place-items-center rounded-full">
              <StorefrontIcon aria-hidden="true" className="text-muted-foreground size-10" />
            </div>
            <h1 className="text-2xl font-semibold">{t("companyTagSignInTitle")}</h1>
            <p className="text-muted-foreground max-w-xs">{t("companyTagSignInBody")}</p>
            <Button asChild size="lg" className="w-full max-w-xs">
              <Link href={withReturnPath("/login", path)}>{t("signIn")}</Link>
            </Button>
            <p className="text-muted-foreground max-w-xs text-sm">{t("companyTagAppHint")}</p>
          </>
        ) : state.status === "collected" ? (
          <Collected result={state.result} />
        ) : state.status === "error" ? (
          <>
            <div className="bg-muted grid size-24 place-items-center rounded-full">
              <StorefrontIcon aria-hidden="true" className="text-muted-foreground size-10" />
            </div>
            <h1 className="text-2xl font-semibold">{t("companyTagNotCollected")}</h1>
            <p className="text-muted-foreground max-w-xs" role="alert">
              {state.key ? t(state.key) : state.text}
            </p>
            <Button asChild variant="outline">
              <Link href="/people?tab=companies">{t("companyTagOpenDiary")}</Link>
            </Button>
          </>
        ) : null}
      </section>
    </div>
  );
}

function Collected({ result }: { result: ScanResult }) {
  const { t } = useLocale();
  if (result.kind === "person" || !result.sponsor) {
    return (
      <>
        <h1 className="text-2xl font-semibold">
          {t("companyTagSavedPerson", { name: result.person?.displayName ?? "" })}
        </h1>
        <Button asChild>
          <Link href="/people">{t("companyTagOpenDiary")}</Link>
        </Button>
      </>
    );
  }
  const sponsor = result.sponsor;
  return (
    <>
      <div className="ring-primary/30 grid size-32 place-items-center overflow-hidden rounded-full bg-white shadow-sm ring-4">
        {sponsor.logoUrl ? (
          <SponsorLogo
            logoUrl={sponsor.logoUrl}
            logoNegativeUrl={sponsor.logoNegativeUrl}
            alt=""
            className="size-20 object-contain"
          />
        ) : (
          <span className="text-3xl font-semibold text-neutral-700">{initials(sponsor.name)}</span>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">{t("companyTagCollected")}</p>
        <h1 className="text-2xl font-semibold">{sponsor.name}</h1>
      </div>
      <Button asChild size="lg" className="w-full max-w-xs">
        <Link href="/people?tab=companies">{t("companyTagOpenDiary")}</Link>
      </Button>
    </>
  );
}
