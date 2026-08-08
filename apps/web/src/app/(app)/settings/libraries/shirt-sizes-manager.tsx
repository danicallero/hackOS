"use client";

// T-shirt size catalogue (H12), rendered inside the Libraries page's tab.
// Same shared-reference-list shape as food intolerances and universities —
// the options every shirt-size picker in the app renders (applications,
// invite claim, profile self-edit, staff user-edit) — stored as a single
// event_config column, edited via GET/PUT /api/event (capability
// INTOLERANCES_MANAGE, same as the rest of this page).

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ContextualError } from "@/components/common/contextual-error";
import { SaveStatus } from "@/components/common/save-status";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EventConfig } from "@/lib/types";
import { useCategorySaveState } from "../event/use-category-save-state";

const NOOP_DIRTY_CHANGE = () => {};

const schema = z.object({
  shirtSizes: z
    .array(z.object({ value: z.string().trim().min(1).max(10) }))
    .min(1)
    .refine(
      (sizes) => new Set(sizes.map((s) => s.value.toLowerCase())).size === sizes.length,
      "duplicate",
    ),
});

type Values = z.infer<typeof schema>;

export function ShirtSizesManager() {
  const { t } = useLocale();
  const [config, setConfig] = useState<EventConfig | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { shirtSizes: [] },
  });
  const { reset, formState, control } = form;
  const shirtSizeFields = useFieldArray({ control, name: "shirtSizes" });
  const [saveState, setSaveState] = useCategorySaveState(formState.isDirty, NOOP_DIRTY_CHANGE);

  useEffect(() => {
    api
      .get<EventConfig>("/api/event")
      .then((cfg) => {
        setConfig(cfg);
        reset({ shirtSizes: cfg.shirtSizes.map((value) => ({ value })) });
        setStatus("ready");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("couldNotLoadEventSettings"));
        setStatus("error");
      });
  }, [reset, t]);

  async function onSubmit(values: Values) {
    setSaveState("saving");
    try {
      const next = await api.put<EventConfig>("/api/event", {
        shirtSizes: values.shirtSizes.map((s) => s.value.trim()),
      });
      setConfig(next);
      reset({ shirtSizes: next.shirtSizes.map((value) => ({ value })) });
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"));
    }
  }

  if (status === "loading") {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label={t("loading")}>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    );
  }
  if (status === "error" || !config) {
    return (
      <ContextualError
        message={error ?? t("couldNotLoadEventSettings")}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-muted-foreground text-sm">{t("shirtSizesGroupDesc")}</p>
        <div className="flex flex-wrap gap-2">
          {shirtSizeFields.fields.map((item, index) => (
            <FormField
              key={item.id}
              control={form.control}
              name={`shirtSizes.${index}.value`}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-1">
                    <FormControl>
                      <Input {...field} className="w-20" maxLength={10} />
                    </FormControl>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive size-8 shrink-0"
                      disabled={shirtSizeFields.fields.length <= 1}
                      onClick={() => shirtSizeFields.remove(index)}
                    >
                      <XIcon className="size-4" />
                      <span className="sr-only">{t("remove")}</span>
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => shirtSizeFields.append({ value: "" })}
          >
            <PlusIcon />
            {t("addSize")}
          </Button>
        </div>
        {form.formState.errors.shirtSizes?.root?.message && (
          <p className="text-destructive text-sm">{t("shirtSizesDuplicateError")}</p>
        )}
        <div className="flex items-center gap-3">
          <SubmitButton pending={formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
          <SaveStatus state={saveState} />
        </div>
      </form>
    </Form>
  );
}
