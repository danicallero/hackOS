"use client";

import type { FieldValues, Path, PathValue, UseFormReturn } from "react-hook-form";
import { PublicationControls } from "@/components/common/publication-controls";
import type { Visibility } from "@/lib/challenges";
import { toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";

/**
 * Visibility and delayed-publication fields bound to a form that has
 * `visibility` and `availableFrom` (a datetime-local string). Showing a record
 * clears its scheduled date; scheduling starts from the current time (H45, H48).
 */
export function PublicationFormFields<
  T extends FieldValues & { visibility: Visibility; availableFrom: string },
>({
  id,
  form,
  scheduled,
  setScheduled,
  disabled,
}: {
  id: string;
  form: UseFormReturn<T>;
  scheduled: boolean;
  setScheduled: (scheduled: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const set = (name: "visibility" | "availableFrom", value: string) =>
    form.setValue(name as Path<T>, value as PathValue<T, Path<T>>, { shouldDirty: true });
  return (
    <PublicationControls
      id={id}
      visibility={form.watch("visibility" as Path<T>) as Visibility}
      hiddenValue="hidden"
      publishedValue="visible"
      hiddenLabel={t("hiddenOption")}
      publishedLabel={t("visibleLabel")}
      visibilityLabel={t("colVisibility")}
      scheduleLabel={t("schedulePublicationLabel")}
      publishAtLabel={t("publishAtLabel")}
      scheduled={scheduled}
      publishAt={form.watch("availableFrom" as Path<T>) as string}
      disabled={disabled}
      onVisibilityChange={(next) => {
        set("visibility", next);
        if (next === "visible") {
          setScheduled(false);
          set("availableFrom", "");
        }
      }}
      onScheduledChange={(next) => {
        setScheduled(next);
        set("availableFrom", next ? toDatetimeLocal(new Date().toISOString()) : "");
      }}
      onPublishAtChange={(value) => set("availableFrom", value)}
    />
  );
}
