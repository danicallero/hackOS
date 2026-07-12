"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { MultiSelect } from "@/components/common/multi-select";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
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
import { ApiError, api } from "@/lib/api";
import { languageName, pickText, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import type { Intolerance, Language, Me } from "@/lib/types";
import { EmailCard } from "./email-card";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
const LANGS: Language[] = ["es", "gl", "en"];

const schema = z.object({
  name: z.string().min(1, "Required").max(200),
  surname: z.string().min(1, "Required").max(200),
  phone: z.string().max(50),
  language: z.enum(["en", "es", "gl"]),
  shirtSize: z.string(),
  foodIntolerances: z.array(z.string()),
  foodIntoleranceNotes: z.string().max(2000),
});

type Values = z.infer<typeof schema>;

const NONE = "__none__";

export default function ProfileSettingsPage() {
  const { me, refresh } = useSessionContext();
  const { t } = useLocale();
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);
  const lang = (me?.language as Language) ?? "es";

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      surname: "",
      phone: "",
      language: "es",
      shirtSize: NONE,
      foodIntolerances: [],
      foodIntoleranceNotes: "",
    },
  });
  const { reset } = form;

  // Dictionary options for the picker (H12/H25).
  useEffect(() => {
    api
      .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances")
      .then((r) => setIntolerances(r.intolerances))
      .catch(() => setIntolerances([]));
  }, []);

  useEffect(() => {
    if (!me) return;
    reset({
      name: me.name ?? "",
      surname: me.surname ?? "",
      phone: me.phone ?? "",
      // Coerce to a known locale — stray/empty values would leave the select blank.
      language: (LANGS.includes(me.language as Language) ? me.language : "es") as Language,
      shirtSize: me.shirtSize ?? NONE,
      foodIntolerances: (me.foodIntolerances ?? []).map(String),
      foodIntoleranceNotes: me.foodIntoleranceNotes ?? "",
    });
  }, [me, reset]);

  async function onSubmit(values: Values) {
    try {
      await api.patch<Me>("/api/me", {
        name: values.name,
        surname: values.surname,
        phone: values.phone || null,
        language: values.language,
        shirtSize: values.shirtSize === NONE ? null : values.shirtSize,
        foodIntolerances: values.foodIntolerances.map(Number),
        foodIntoleranceNotes: values.foodIntoleranceNotes || null,
      });
      await refresh();
      toast.success(t("profileUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveProfile"));
    }
  }

  if (!me) return null;

  const intoleranceOptions = intolerances.map((i) => ({
    value: String(i.id),
    label: pickText(i.label, lang),
    description: i.description ? pickText(i.description, lang) : undefined,
  }));

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <SectionCard
            icon={UserIcon}
            title={t("personalDetails")}
            footer={
              <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
            }
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("firstName")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="given-name" {...field} />
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
                    <Input autoComplete="family-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("phone")}</FormLabel>
                  <FormControl>
                    <Input type="tel" autoComplete="tel" {...field} />
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
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("notSet")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("notSet")}</SelectItem>
                      {SHIRT_SIZES.map((s) => (
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
            <FormField
              control={form.control}
              name="foodIntolerances"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("foodIntolerances")}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={intoleranceOptions}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t("selectIntolerances")}
                      searchPlaceholder={t("searchIntolerances")}
                      emptyText={t("noIntolerances")}
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
                    <Textarea rows={3} placeholder={t("cateringNotes")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SectionCard>
        </form>
      </Form>
      <EmailCard />
    </div>
  );
}
