"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/common/brand";
import { LanguageSelect } from "@/components/common/language-select";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { useLocale } from "@/lib/i18n";

export function LegalPage({
  title,
  description,
  updatedAt,
  children,
}: {
  title: string;
  description: string;
  updatedAt: string;
  children: ReactNode;
}) {
  const { t } = useLocale();

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" aria-label={t("backHome")}>
            <Brand />
          </Link>
          <div className="flex items-center gap-1">
            <LanguageSelect />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <header className="border-b pb-8">
          <h1 className="mt-2 text-balance text-3xl font-semibold sm:text-4xl">{title}</h1>
          <p className="text-muted-foreground mt-4 max-w-2xl text-pretty text-base leading-7">
            {description}
          </p>
          <p className="text-muted-foreground mt-4 text-sm">
            {t("lastUpdated")}: {updatedAt}
          </p>
        </header>

        <article className="space-y-10 py-10">{children}</article>
      </main>

      <footer className="text-muted-foreground border-t px-5 py-8 text-center text-sm">
        <nav
          aria-label={t("legalLinksLabel")}
          className="flex flex-wrap justify-center gap-x-5 gap-y-2"
        >
          <Link className="underline underline-offset-4 hover:text-foreground" href="/terms">
            {t("termsAndConditions")}
          </Link>
          <Link className="underline underline-offset-4 hover:text-foreground" href="/privacy">
            {t("privacyPolicy")}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
