"use client";

import { PageLayout } from "@/components/common/page-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/lib/i18n";

/**
 * Route-level fallback while a workspace's code loads: the page-title row, a
 * toolbar and table-height rows, so the real list lands without moving the
 * header or reflowing the canvas. Pages that already know their data shape
 * render their own skeleton (e.g. DataTable `loading`).
 */
export default function AppLoading() {
  const { t } = useLocale();
  return (
    <PageLayout>
      <div role="status" aria-busy="true" aria-label={t("loading")} className="space-y-6">
        <Skeleton className="h-8 w-48" aria-hidden="true" />
        <div className="space-y-4" aria-hidden="true">
          <div className="flex gap-2">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div className="divide-y rounded-lg border">
            {["one", "two", "three", "four", "five", "six"].map((key) => (
              <div key={key} className="flex h-12 items-center gap-4 px-4">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
