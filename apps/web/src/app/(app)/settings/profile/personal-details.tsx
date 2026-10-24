"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { MultiSelect } from "@/components/common/multi-select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFoodIntolerances } from "@/hooks/use-food-intolerances";
import { useShirtSizes } from "@/hooks/use-shirt-sizes";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { languageName, pickText, type Translate, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Language, Me } from "@/lib/types";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";
import { ProfilePhoto } from "./profile-photo";

const LANGS: Language[] = ["es", "gl", "en"];

function profileSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t("required")).max(200),
    surname: z.string().min(1, t("required")).max(200),
    language: z.enum(["en", "es", "gl"]),
    shirtSize: z.string(),
    foodIntolerances: z.array(z.string()),
    foodIntoleranceNotes: z.string().max(2000),
    // #933: an explicit empty answer, distinct from never having answered.
    noRestrictions: z.boolean(),
  });
}

type Values = z.infer<ReturnType<typeof profileSchema>>;

const NONE = "__none__";

function valuesFromMe(me: Me): Values {
  return {
    name: me.name ?? "",
    surname: me.surname ?? "",
    // Coerce to a known locale — stray/empty values would leave the select blank.
    language: (LANGS.includes(me.language as Language) ? me.language : "es") as Language,
    shirtSize: me.shirtSize ?? NONE,
    foodIntolerances: (me.foodIntolerances ?? []).map(String),
    foodIntoleranceNotes: me.foodIntoleranceNotes ?? "",
    noRestrictions:
      me.dietaryConfirmedAt !== null &&
      (me.foodIntolerances ?? []).length === 0 &&
      !me.foodIntoleranceNotes?.trim(),
  };
}

/**
 * Personal details and the dietary answer, saved together through one Save.
 * Keyed by user id so the form (and its Radix Selects) mounts fresh with the
 * right defaultValues instead of flipping value post-mount via reset() — a
 * post-mount value change on a Select whose options were never rendered gets
 * silently clobbered back to "" by Radix's hidden native-select sync.
 */
export function PersonalDetails({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { me } = useSessionContext();
  if (!me) return null;
  return <PersonalDetailsForm key={me.id} me={me} onDirtyChange={onDirtyChange} />;
}

function PersonalDetailsForm({
  me,
  onDirtyChange,
}: {
  me: Me;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { refresh } = useSessionContext();
  const { t } = useLocale();
  const lang = (me.language as Language) ?? "es";
  const schema = useMemo(() => profileSchema(t), [t]);
  // Dictionary options for the pickers (H12/H25).
  const dictionary = useFoodIntolerances();
  const intolerances = dictionary.intolerances;
  const shirtSizeList = useShirtSizes();
  const shirtSizes = shirtSizeList.sizes;

  const form = useForm<Values>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(schema),
    defaultValues: valuesFromMe(me),
  });
  // H7: name and logistics data (shirt size, dietary info) are locked once
  // an application is accepted — staff can still fix them via the user detail page.
  const locked = me.profileLocked;
  // Dietary data takes one late write, then only staff change it.
  const dietaryLocked = me.dietaryLocked;
  const [saveError, setSaveError] = useState<string | null>(null);
  const isDirty = form.formState.isDirty;
  useUnsavedChangesGuard(isDirty);
  useEffect(() => onDirtyChange(isDirty), [onDirtyChange, isDirty]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const noRestrictions = form.watch("noRestrictions");
  // Restored when "No restrictions" is unticked again.
  const dietaryBeforeNone = useRef({ foodIntolerances: [] as string[], foodIntoleranceNotes: "" });

  async function onSubmit(values: Values) {
    setSaveError(null);
    if (!form.formState.isDirty) return;
    const dirty = form.formState.dirtyFields;
    // Sending dietary fields records an answer (#933), so only send them when edited.
    const dietaryEdited = Boolean(
      dirty.foodIntolerances || dirty.foodIntoleranceNotes || dirty.noRestrictions,
    );
    // Same rule as the next-entry prompt: an empty answer must be "No restrictions".
    if (
      dietaryEdited &&
      !values.noRestrictions &&
      values.foodIntolerances.length === 0 &&
      !values.foodIntoleranceNotes.trim()
    ) {
      form.setError("noRestrictions", { message: t("dietaryAnswerRequired") });
      return;
    }
    try {
      await api.patch<Me>("/api/me", {
        name: values.name,
        surname: values.surname,
        language: values.language,
        shirtSize: values.shirtSize === NONE ? null : values.shirtSize,
        ...(dietaryEdited && {
          foodIntolerances: values.foodIntolerances.map(Number),
          foodIntoleranceNotes: values.foodIntoleranceNotes || null,
        }),
      });
      form.reset(values);
      await refresh();
      toast.success(t("profileUpdated"), { compactTitle: t("toastSaveProfile") });
    } catch (err) {
      setSaveError(apiErrorText(err, t, t("couldNotSaveProfile")));
      toast.error(apiErrorText(err, t, t("couldNotSaveProfile")), t("toastSaveProfile"));
    }
  }

  const intoleranceOptions = intolerances.map((i) => ({
    value: String(i.id),
    label: pickText(i.label, lang),
    description: i.description ? pickText(i.description, lang) : undefined,
  }));

  return (
    <Form {...form}>
      <form className="@container min-w-0" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="min-w-0 space-y-6">
          {locked && (
            <p className="text-muted-foreground text-pretty text-sm">{t("profileLockedNotice")}</p>
          )}
          {saveError && <ContextualError message={saveError} />}
          {/* The account photo saves on its own and leads the details it belongs to (#934). */}
          <ProfilePhoto />
          <div className="grid min-w-0 items-start gap-4 @xl:grid-cols-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("firstName")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="given-name" disabled={locked} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="surname"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("lastName")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="family-name" disabled={locked} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="language"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("language")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {LANGS.map((language) => (
                        <SelectItem key={language} value={language}>
                          {languageName(language)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="shirtSize"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("shirtSize")}</FormLabel>
                  {shirtSizeList.error ? (
                    <ContextualError
                      message={t("couldNotLoadDictionary")}
                      onRetry={shirtSizeList.reload}
                    />
                  ) : null}
                  <Select onValueChange={field.onChange} value={field.value} disabled={locked}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("notSet")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("notSet")}</SelectItem>
                      {shirtSizes.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <section className="space-y-4 pt-2">
            <h3 className="type-label text-muted-foreground">{t("dietaryRestrictions")}</h3>
            <FormField
              control={form.control}
              name="noRestrictions"
              render={({ field }) => (
                <FormItem className="flex flex-wrap items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      disabled={dietaryLocked}
                      onCheckedChange={(checked) => {
                        const none = checked === true;
                        field.onChange(none);
                        form.clearErrors("noRestrictions");
                        const opts = { shouldDirty: true };
                        if (none) {
                          dietaryBeforeNone.current = {
                            foodIntolerances: form.getValues("foodIntolerances"),
                            foodIntoleranceNotes: form.getValues("foodIntoleranceNotes"),
                          };
                          form.setValue("foodIntolerances", [], opts);
                          form.setValue("foodIntoleranceNotes", "", opts);
                        } else {
                          const before = dietaryBeforeNone.current;
                          form.setValue("foodIntolerances", before.foodIntolerances, opts);
                          form.setValue("foodIntoleranceNotes", before.foodIntoleranceNotes, opts);
                        }
                      }}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">{t("noRestrictions")}</FormLabel>
                  <FormMessage className="basis-full" />
                </FormItem>
              )}
            />
            {!noRestrictions && (
              <div className="grid items-start gap-4 @xl:grid-cols-2">
                <FormField
                  control={form.control}
                  name="foodIntolerances"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("foodIntolerances")}</FormLabel>
                      {dictionary.error ? (
                        <ContextualError
                          message={t("couldNotLoadDictionary")}
                          onRetry={dictionary.reload}
                        />
                      ) : null}
                      <FormControl>
                        <MultiSelect
                          options={intoleranceOptions}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t("selectIntolerances")}
                          searchPlaceholder={t("searchIntolerances")}
                          emptyText={t("noIntolerances")}
                          disabled={dietaryLocked || noRestrictions}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="foodIntoleranceNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("otherDietaryNotes")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder={t("cateringNotes")}
                          disabled={dietaryLocked || noRestrictions}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
          </section>
        </div>
        <div className="mt-6">
          <FormActions
            pending={form.formState.isSubmitting}
            disabled={!isDirty}
            state={saveError ? "error" : isDirty ? "unsaved" : "saved"}
          />
        </div>
      </form>
    </Form>
  );
}
