"use client";

// T-shirt size catalogue (H12), rendered inside the Libraries page's tab.
// Same shared-reference-list shape as food intolerances and universities —
// the options every shirt-size picker in the app renders (applications,
// invite claim, profile self-edit, staff user-edit) — stored as a single
// event_config column, edited via GET/PUT /api/event (capability
// INTOLERANCES_MANAGE, same as the rest of this page).
//
// Sizes are stored as plain text on each person, so the list order is only
// presentation: chips are drag-reorderable, but a saved size is not editable
// in place (renaming would orphan everyone holding it). To rename, add the new
// size and remove the old one — the API refuses to drop a size still in use.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { zodResolver } from "@hookform/resolvers/zod";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { ContextualError } from "@/components/common/contextual-error";
import { DragHandle, SortableItem } from "@/components/common/drag-handle";
import { SaveStatus } from "@/components/common/save-status";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { EventConfig } from "@/lib/types";
import { useCategorySaveState } from "../event/use-category-save-state";
import { LibraryAddButton } from "./library-add-button";

const NOOP_DIRTY_CHANGE = () => {};

const schema = z.object({
  shirtSizes: z
    .array(z.object({ value: z.string().trim().min(1).max(10), saved: z.boolean() }))
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [saveState, setSaveState] = useCategorySaveState(formState.isDirty, NOOP_DIRTY_CHANGE);

  useEffect(() => {
    api
      .get<EventConfig>("/api/event")
      .then((cfg) => {
        setConfig(cfg);
        reset({ shirtSizes: cfg.shirtSizes.map((value) => ({ value, saved: true })) });
        setStatus("ready");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("couldNotLoadEventSettings"));
        setStatus("error");
      });
  }, [reset, t]);

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = shirtSizeFields.fields.findIndex((f) => f.id === active.id);
    const to = shirtSizeFields.fields.findIndex((f) => f.id === over.id);
    if (from !== -1 && to !== -1) shirtSizeFields.move(from, to);
  }

  async function onSubmit(values: Values) {
    setSaveState("saving");
    try {
      const next = await api.put<EventConfig>("/api/event", {
        shirtSizes: values.shirtSizes.map((s) => s.value.trim()),
      });
      setConfig(next);
      reset({ shirtSizes: next.shirtSizes.map((value) => ({ value, saved: true })) });
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      const inUse =
        err instanceof ApiError
          ? (err.details as { shirtSizesInUse?: { value: string; count: number }[] } | undefined)
              ?.shirtSizesInUse
          : undefined;
      toast.error(
        inUse
          ? t("shirtSizesInUseError", {
              sizes: inUse.map((s) => `${s.value} (${s.count})`).join(", "),
            })
          : err instanceof ApiError
            ? err.message
            : t("couldNotSaveEventSettings"),
        t("toastShirtSizes"),
      );
    }
  }

  if (status === "loading") {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label={t("loading")}>
        <Skeleton className="h-[var(--control-height-default)] w-full" />
        <Skeleton className="h-[var(--control-height-default)] w-2/3" />
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
        <div className="@container flex flex-wrap items-start gap-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={shirtSizeFields.fields.map((f) => f.id)}
              strategy={rectSortingStrategy}
            >
              {shirtSizeFields.fields.map((item, index) => (
                <SortableItem key={item.id} id={item.id}>
                  {({ attributes, listeners }) => (
                    <FormField
                      control={form.control}
                      name={`shirtSizes.${index}.value`}
                      render={({ field }) => (
                        <FormItem className="gap-1">
                          <div className="border-input bg-background focus-within:border-ring focus-within:ring-ring/50 flex h-[var(--control-height-default)] items-center gap-0.5 rounded-full border pl-1 pr-1 focus-within:ring-[3px]">
                            <DragHandle
                              attributes={attributes}
                              listeners={listeners}
                              label={t("dragToReorderAria", { name: field.value })}
                            />
                            {item.saved ? (
                              <span className="w-14 px-1 text-sm">{field.value}</span>
                            ) : (
                              <FormControl>
                                <input
                                  {...field}
                                  maxLength={10}
                                  className="w-14 bg-transparent px-1 text-sm outline-none"
                                />
                              </FormControl>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={t("removeItemLabel", { name: field.value })}
                              className="hover:text-foreground text-muted-foreground shrink-0 rounded-full"
                              disabled={shirtSizeFields.fields.length <= 1}
                              onClick={() => shirtSizeFields.remove(index)}
                            >
                              <XIcon aria-hidden="true" className="size-3" />
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </SortableItem>
              ))}
            </SortableContext>
          </DndContext>
          <LibraryAddButton
            label={t("addSize")}
            onClick={() => shirtSizeFields.append({ value: "", saved: false })}
          />
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
