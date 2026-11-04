"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/lib/i18n";

/** H55: only the content under Home's persistent header, and only after 400 ms. */
export default function HomeLoading() {
  const { t } = useLocale();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className="loading-delayed space-y-4"
    >
      <Skeleton className="h-9 w-full" aria-hidden="true" />
      <Skeleton className="h-64 w-full" aria-hidden="true" />
    </div>
  );
}
