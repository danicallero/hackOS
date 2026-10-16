"use client";

import { PageLayout } from "@/components/common/page-layout";
import { ProjectsSectionHeader } from "@/components/common/section-navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Section } from "@/components/ui/surface";
import { useLocale } from "@/lib/i18n";

/** H18: immediate navigation feedback mirrors the final catalogue geometry. */
export default function GalleryLoading() {
  const { t } = useLocale();
  return (
    <PageLayout>
      <ProjectsSectionHeader />
      <div role="status" aria-busy="true" aria-label={t("loading")} className="space-y-6">
        <div className="flex gap-2" aria-hidden="true">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="grid auto-rows-fr gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {["one", "two", "three", "four", "five", "six"].map((key) => (
            <Section key={key} padding="none" className="flex min-h-64 flex-col">
              <div className="border-b p-5">
                <Skeleton className="h-6 w-3/5" />
              </div>
              <div className="flex flex-1 flex-col gap-3 p-5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="mt-3 h-4 w-2/3" />
                <div className="mt-auto flex items-center justify-between pt-4">
                  <div className="flex -space-x-2">
                    {[1, 2, 3].map((member) => (
                      <Skeleton key={member} className="size-8 rounded-full" />
                    ))}
                  </div>
                  <Skeleton className="h-8 w-28 rounded-full" />
                </div>
              </div>
            </Section>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
