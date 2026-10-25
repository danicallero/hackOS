"use client";

// #1083: the root of /verify: type the CSV printed on a certificate copy to open the official document.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PdfCheck } from "@/components/certificates/pdf-check";
import { PublicTopBar } from "@/components/layout/public-top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n";

/** Accepts the bare code or the whole verification link the QR points to. */
function codeFrom(value: string): string {
  const trimmed = value.trim();
  const fromLink = /\/verify\/([^/?#\s]+)/.exec(trimmed)?.[1];
  return fromLink ?? trimmed;
}

// The API rejects anything shorter than this (certificates carry 24 characters).
const MIN_CODE_LENGTH = 16;

export default function VerifyRootPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [value, setValue] = useState("");
  const code = codeFrom(value);

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicTopBar />
      <main
        id="main-content"
        tabIndex={-1}
        className="outline-none grid flex-1 place-items-center px-6 pb-24"
      >
        <form
          className="flex w-full max-w-md flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.length >= MIN_CODE_LENGTH) router.push(`/verify/${encodeURIComponent(code)}`);
          }}
        >
          <Label htmlFor="certificate-csv">{t("certificateCodeLabel")}</Label>
          <div className="flex gap-2">
            <Input
              id="certificate-csv"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              className="font-mono"
            />
            <Button type="submit" disabled={code.length < MIN_CODE_LENGTH}>
              {t("certificateVerifyAction")}
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            <PdfCheck />
          </div>
        </form>
      </main>
    </div>
  );
}
