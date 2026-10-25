"use client";

import type { ReactNode } from "react";
import { PublicFooter } from "@/components/layout/public-footer";
import { PublicTopBar } from "@/components/layout/public-top-bar";
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
      <PublicTopBar />

      <main
        id="main-content"
        tabIndex={-1}
        className="outline-none mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16"
      >
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

      <PublicFooter />
    </div>
  );
}
