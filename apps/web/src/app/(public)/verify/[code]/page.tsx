"use client";

// #1083: the page behind the QR and code printed on an attendance certificate.
// It shows the official document and nothing else.

import { XCircleIcon } from "@phosphor-icons/react/dist/csr/XCircle";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/common/brand";
import { Spinner } from "@/components/common/spinner";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

type State = { kind: "loading" } | { kind: "valid" } | { kind: "revoked" } | { kind: "missing" };

export default function VerifyCertificatePage() {
  const { t } = useLocale();
  const { code } = useParams<{ code: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ status: "valid" | "revoked" }>(`/api/public/certificates/${encodeURIComponent(code)}`)
      .then((data) => !cancelled && setState({ kind: data.status }))
      .catch(() => !cancelled && setState({ kind: "missing" }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="bg-background border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center px-6">
          <Brand className="text-2xl" />
        </div>
      </header>
      <main className="bg-muted/40 relative min-h-0 flex-1">
        {state.kind === "valid" ? (
          <iframe
            title={t("certificateVerifyTitle")}
            src={`${API_URL}/api/public/certificates/${encodeURIComponent(code)}/pdf`}
            className="size-full border-0"
          />
        ) : (
          <div className="grid h-full place-items-center px-6" role="status" aria-live="polite">
            {state.kind === "loading" ? (
              <Spinner className="size-7" />
            ) : (
              <p className="text-muted-foreground flex items-center gap-2">
                <XCircleIcon className="size-5" weight="fill" aria-hidden="true" />
                {state.kind === "revoked"
                  ? t("certificateStatusRevoked")
                  : t("certificateNotFound")}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
