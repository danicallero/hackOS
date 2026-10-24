"use client";

// #1083: the root of /verify: type the CSV printed on a certificate copy to open the official document.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/common/brand";
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
      <header className="bg-background border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center px-6">
          <Brand className="text-2xl" />
        </div>
      </header>
      <main className="grid flex-1 place-items-center px-6 pb-24">
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
        </form>
      </main>
    </div>
  );
}
