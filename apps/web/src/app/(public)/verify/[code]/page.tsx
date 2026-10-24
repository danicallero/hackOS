"use client";

// #1083: the page behind the QR and code printed on an attendance certificate.
// It shows the official document and the SHA-256 of its single stored copy, so a
// third party can check that the PDF they hold is that exact file.

import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { XCircleIcon } from "@phosphor-icons/react/dist/csr/XCircle";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PdfCheck } from "@/components/certificates/pdf-check";
import { Brand } from "@/components/common/brand";
import { IconButton } from "@/components/common/icon-button";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

type State = { kind: "loading" } | { kind: "valid" } | { kind: "revoked" } | { kind: "missing" };

export default function VerifyCertificatePage() {
  const { t } = useLocale();
  const { code } = useParams<{ code: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [sha256, setSha256] = useState<string | null>(null);
  const [superseded, setSuperseded] = useState(false);
  const [showHash, setShowHash] = useState(false);
  const endpoint = `/api/public/certificates/${encodeURIComponent(code)}`;

  useEffect(() => {
    let cancelled = false;
    api
      .get<{
        status: "valid" | "revoked";
        sha256: string | null;
        supersededAt: string | null;
      }>(endpoint)
      .then((data) => {
        if (cancelled) return;
        setSha256(data.sha256);
        setSuperseded(data.supersededAt !== null);
        setState({ kind: data.status });
      })
      .catch(() => !cancelled && setState({ kind: "missing" }));
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="bg-background border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center px-6">
          <Brand className="text-2xl" />
        </div>
      </header>
      <main className="bg-muted/40 relative min-h-0 flex-1">
        {state.kind === "valid" ? (
          <div className="flex size-full flex-col">
            <iframe
              title={t("certificateVerifyTitle")}
              src={`${API_URL}${endpoint}/pdf`}
              className="min-h-0 flex-1 border-0"
            />
            {sha256 && (
              <div className="bg-background shrink-0 border-t px-4 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={showHash}
                    onClick={() => setShowHash((open) => !open)}
                  >
                    SHA-256
                    <CaretDownIcon className={showHash ? "rotate-180" : undefined} />
                  </Button>
                  {superseded && <span role="status">{t("certificateNewerVersion")}</span>}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <IconButton asChild variant="outline" label={t("certificateDownload")}>
                      <a href={`${API_URL}${endpoint}/pdf?download=1`}>
                        <DownloadSimpleIcon />
                      </a>
                    </IconButton>
                    <PdfCheck code={code} />
                  </div>
                </div>
                {showHash && (
                  <code className="mt-2 block font-mono text-xs break-all">{sha256}</code>
                )}
              </div>
            )}
          </div>
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
