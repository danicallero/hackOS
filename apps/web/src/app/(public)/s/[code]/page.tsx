"use client";

// Company tag link fallback (#935): `https://<web host>/s/<code>` is what NFC
// tags and printed QR codes carry. Phones with the app open it there; any
// other browser lands here. Signed in, the tag is collected through the same
// diary scan as the app; signed out, the page offers sign-in and returns here.

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import { PublicTopBar } from "@/components/layout/public-top-bar";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { type MessageKey, useLocale } from "@/lib/i18n";
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
  const router = useRouter();
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
        if (started.current !== code) return;
        setState({ status: "collected", result });
        // A scanned stand opens the company's own page; it already says who they are.
        if (result.kind !== "person" && result.sponsor) {
          router.replace(`/companies/${result.sponsor.enterpriseId}`);
        }
      })
      .catch((err: unknown) => {
        if (started.current !== code) return;
        setState({
          status: "error",
          key: collectErrorKey(err),
          text: apiErrorText(err, t, ""),
        });
      });
  }, [status, code, t, router]);

  const redirecting =
    state.status === "collected" && state.result.kind !== "person" && !!state.result.sponsor;
  const shell =
    "mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col items-center gap-5 px-5 py-10 text-center";

  return (
    <div className="min-h-dvh">
      <PublicTopBar access={false} />
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-[calc(100dvh-4rem)]"
        aria-live="polite"
      >
        <div className={shell}>
          {status === "loading" ||
          (status === "authenticated" && (state.status === "collecting" || redirecting)) ? (
            <div className="grid place-items-center py-24" role="status" aria-busy="true">
              <Spinner className="size-7" />
              <span className="sr-only">{t("companyTagCollecting")}</span>
            </div>
          ) : status === "unauthenticated" ? (
            <>
              <h1 className="type-page-title">{t("companyTagSignInTitle")}</h1>
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
              <h1 className="type-page-title">{t("companyTagNotCollected")}</h1>
              <p className="text-muted-foreground max-w-xs" role="alert">
                {state.key ? t(state.key) : state.text}
              </p>
              <Button asChild variant="outline">
                <Link href="/people?tab=companies">{t("companyTagOpenDiary")}</Link>
              </Button>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function Collected({ result }: { result: ScanResult }) {
  const { t } = useLocale();
  if (result.kind === "person" || !result.sponsor) {
    return (
      <>
        <h1 className="type-page-title">
          {t("companyTagSavedPerson", { name: result.person?.displayName ?? "" })}
        </h1>
        <Button asChild>
          <Link href="/people">{t("companyTagOpenDiary")}</Link>
        </Button>
      </>
    );
  }
  return null;
}
