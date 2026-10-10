"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { type ReactNode, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { dialogIconButtonClass } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiAssetUrl } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";

type CvState =
  | { status: "loading" }
  | { status: "ready"; url: string; filename: string }
  | { status: "missing" }
  | { status: "error"; message: string | null };

/**
 * The file name from a `content-disposition` header: the RFC 5987
 * `filename*` (UTF-8, percent-encoded) wins over the ASCII `filename`.
 */
export function dispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Malformed encoding: fall back to the ASCII name.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(header);
  const name = (plain?.[1] ?? plain?.[2])?.trim();
  return name || null;
}

/**
 * Reads the CV as a blob with the session cookie (the API is another origin,
 * so an iframe pointed at it would depend on third-party cookies) and exposes
 * it as an object URL that is revoked when the viewer closes (#935).
 */
function useCvBlob(path: string, open: boolean, attempt: number): CvState {
  const [state, setState] = useState<CvState>({ status: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is a retry nonce that re-runs the read.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let url: string | null = null;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(apiAssetUrl(path), {
          credentials: "include",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (res.status === 404) {
          setState({ status: "missing" });
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setState({ status: "error", message: body?.error?.message ?? null });
          return;
        }
        const raw = await res.blob();
        if (controller.signal.aborted) return;
        // The route always serves a PDF; pin the type so the built-in viewer renders it.
        const blob =
          raw.type === "application/pdf" ? raw : new Blob([raw], { type: "application/pdf" });
        url = URL.createObjectURL(blob);
        setState({
          status: "ready",
          url,
          filename: dispositionFilename(res.headers.get("content-disposition")) ?? "CV.pdf",
        });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", message: null });
      }
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, open, attempt]);

  return open ? state : { status: "loading" };
}

/** `navigator.pdfViewerEnabled` is false where PDFs cannot render inline. */
function inlinePdfSupported(): boolean {
  return typeof navigator === "undefined" || navigator.pdfViewerEnabled !== false;
}

/**
 * In-app CV viewer (#935): the browser's own PDF viewer inside a near
 * full-height dialog (full screen on phones), with Download (original file
 * name) and Open in new tab. `trigger` is the element that opens it.
 */
export function CvViewer({
  path,
  name,
  notFoundTitle,
  trigger,
}: {
  /** Authenticated API path of the CV (`DirectoryEntry.cvUrl` or the owner's route). */
  path: string;
  /** Whose CV it is, for the title. */
  name: string;
  /** Copy for a 404; defaults to "Person not found" (hidden profile or unshared CV). */
  notFoundTitle?: string;
  trigger: ReactNode;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const state = useCvBlob(path, open, attempt);
  const title = t("cvViewerTitle", { name });

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      title={title}
      icon={FilePdfIcon}
      // Phones: the whole screen. Desktop: wide and nearly full height.
      className="h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),72rem)] sm:max-w-none max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:gap-3 max-sm:rounded-none max-sm:border-0 max-sm:p-4"
      headerActions={
        // Nothing to download or open once the CV is gone.
        state.status === "missing" ? undefined : (
          <>
            {state.status === "ready" ? (
              <a
                href={state.url}
                download={state.filename}
                className={dialogIconButtonClass}
                aria-label={t("downloadCv")}
                title={t("downloadCv")}
              >
                <DownloadSimpleIcon aria-hidden="true" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className={dialogIconButtonClass}
                aria-label={t("downloadCv")}
                title={t("downloadCv")}
              >
                <DownloadSimpleIcon aria-hidden="true" />
              </button>
            )}
            <a
              href={apiAssetUrl(path)}
              target="_blank"
              rel="noreferrer"
              className={dialogIconButtonClass}
              aria-label={t("openInNewTab")}
              title={t("openInNewTab")}
            >
              <ArrowSquareOutIcon aria-hidden="true" />
            </a>
          </>
        )
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {state.status === "loading" ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t("loading")}
            className="bg-muted/40 flex min-h-0 flex-1 justify-center overflow-hidden rounded-control border border-border/60 p-4 sm:p-8"
          >
            {/* One page outline, the shape the PDF will take. */}
            <Skeleton className="aspect-[1/1.414] h-full max-w-full rounded-sm max-sm:h-auto max-sm:w-full max-sm:self-start" />
          </div>
        ) : state.status === "ready" ? (
          inlinePdfSupported() ? (
            <iframe
              src={state.url}
              title={title}
              className="min-h-0 w-full flex-1 rounded-control border border-border/60 bg-background"
            />
          ) : (
            // Browsers without an inline PDF viewer (Chrome on Android) get the file itself.
            <EmptyState
              icon={FilePdfIcon}
              title={state.filename}
              className="flex-1"
              action={
                <Button asChild>
                  <a href={state.url} download={state.filename}>
                    <DownloadSimpleIcon aria-hidden="true" />
                    {t("downloadCv")}
                  </a>
                </Button>
              }
            />
          )
        ) : state.status === "missing" ? (
          <EmptyState
            icon={FilePdfIcon}
            title={notFoundTitle ?? t("personNotFound")}
            className="flex-1"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <ContextualError
              className="w-full max-w-md"
              message={state.message ?? t("couldNotLoadCv")}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
