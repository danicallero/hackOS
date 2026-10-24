"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Result =
  | { kind: "checking" }
  | { kind: "same" }
  | { kind: "other"; code: string }
  | { kind: "unknown" }
  | { kind: "error" };

/**
 * #1083: checks a downloaded PDF against the stored copies. The file is hashed in the
 * browser and only its SHA-256 is sent. With `code`, says whether the file is that
 * certificate's copy; without it, finds the certificate the file belongs to. Renders the
 * button and, on its own line, the result: place it inside a wrapping flex row.
 */
export function PdfCheck({ code }: { code?: string }) {
  const { t } = useLocale();
  const [result, setResult] = useState<Result | null>(null);

  async function check(file: File) {
    setResult({ kind: "checking" });
    try {
      const found = await api.get<{ code: string }>(
        `/api/public/certificates/by-hash/${await sha256Hex(file)}`,
      );
      setResult(
        code !== undefined && found.code === code
          ? { kind: "same" }
          : { kind: "other", code: found.code },
      );
    } catch (err) {
      setResult({ kind: err instanceof ApiError && err.status === 404 ? "unknown" : "error" });
    }
  }

  return (
    <>
      <Button asChild variant="outline" size="sm" loading={result?.kind === "checking"}>
        <label>
          {t("certificateCheckFile")}
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void check(file);
            }}
          />
        </label>
      </Button>
      {result && result.kind !== "checking" && (
        <p role="status" className="basis-full text-sm">
          {result.kind === "same" && t("certificateFileMatches")}
          {result.kind === "unknown" && t("certificateFileUnknown")}
          {result.kind === "error" && t("couldNotLoadCertificates")}
          {result.kind === "other" && (
            <>
              {code === undefined ? t("certificateFileFound") : t("certificateFileOther")}{" "}
              <Link
                href={`/verify/${encodeURIComponent(result.code)}`}
                className="underline underline-offset-4"
              >
                {t("certificateVerifyTitle")}
              </Link>
            </>
          )}
        </p>
      )}
    </>
  );
}
