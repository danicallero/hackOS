"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { MultiSelect } from "@/components/common/multi-select";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { LANGS, languageName, pickText, useLocale } from "@/lib/i18n";
import type { Intolerance, Language, UserDetail } from "@/lib/types";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

const editSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  surname: z.string().min(1, "Required").max(200),
  phone: z.string().max(50),
  language: z.enum(["en", "es", "gl"]),
  shirtSize: z.string(),
  dni: z.string().max(50),
  foodIntolerances: z.array(z.string()),
  foodIntoleranceNotes: z.string().max(2000),
  notes: z.string().max(4000),
});
type EditValues = z.infer<typeof editSchema>;
const NONE = "__none__";

export function StaffEditForm({
  user,
  intolerances,
  onUpdated,
}: {
  user: UserDetail;
  intolerances: Intolerance[];
  onUpdated: () => Promise<void>;
}) {
  const { t } = useLocale();
  const lang = (LANGS.includes(user.language as Language) ? user.language : "es") as Language;

  const localizedEditSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        surname: z.string().min(1, t("required")).max(200),
        phone: z.string().max(50),
        language: z.enum(["en", "es", "gl"]),
        shirtSize: z.string(),
        dni: z.string().max(50),
        foodIntolerances: z.array(z.string()),
        foodIntoleranceNotes: z.string().max(2000),
        notes: z.string().max(4000),
      }),
    [t],
  );

  const form = useForm<EditValues>({
    resolver: zodResolver(localizedEditSchema),
    defaultValues: {
      name: user.name ?? "",
      surname: user.surname ?? "",
      phone: user.phone ?? "",
      language: (LANGS.includes(user.language as Language) ? user.language : "es") as Language,
      shirtSize: user.shirtSize ?? NONE,
      dni: user.dni ?? "",
      foodIntolerances: (user.foodIntolerances ?? []).map(String),
      foodIntoleranceNotes: user.foodIntoleranceNotes ?? "",
      notes: user.notes ?? "",
    },
  });

  const intoleranceOptions = intolerances.map((i) => ({
    value: String(i.id),
    label: pickText(i.label, lang),
    description: i.description ? pickText(i.description, lang) : undefined,
  }));

  const [secEmail, setSecEmail] = useState("");
  const [secSending, setSecSending] = useState(false);

  async function onSubmit(values: EditValues) {
    try {
      await api.patch<UserDetail>(`/api/users/${user.id}`, {
        name: values.name,
        surname: values.surname,
        phone: values.phone || null,
        language: values.language,
        shirtSize: values.shirtSize === NONE ? null : values.shirtSize,
        dni: values.dni || null,
        foodIntolerances: values.foodIntolerances.map(Number),
        foodIntoleranceNotes: values.foodIntoleranceNotes || null,
        notes: values.notes || null,
      });
      await onUpdated();
      toast.success(t("profileUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveProfile"));
    }
  }

  async function handleSetSecondaryEmail() {
    setSecSending(true);
    try {
      await api.post(`/api/users/${user.id}/secondary-email`, {
        email: secEmail.trim().toLowerCase(),
      });
      toast.success(t("secondaryEmailSetNeedsVerify"));
      setSecEmail("");
      await onUpdated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSetSecondaryEmail"));
    } finally {
      setSecSending(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={UserIcon}
          title={t("profileDetails")}
          description={t("editThisUsersDetails")}
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
                  <Input {...field} />
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
                  <Input {...field} />
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
                  <Input type="tel" {...field} />
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
                    {LANGS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {languageName(l)}
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
            name="dni"
            render={({ field }) => (
              <FormItem>
                <FormLabel>DNI</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
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
                <FormLabel>{t("dietaryNotesLabel")}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("staffNotesLabel")}</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder={t("internalNotesPlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Separator className="my-4" />
          <div className="space-y-4">
            <h4 className="text-sm font-medium">{t("secondaryEmailLabel")}</h4>
            {user.secondaryEmail && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t("currentEmailInline", { email: user.secondaryEmail })}
                </span>
                <StatusBadge tone={user.secondaryEmailVerified ? "success" : "warning"} dot={false}>
                  {user.secondaryEmailVerified ? t("verified") : t("pendingShort")}
                </StatusBadge>
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="admin-sec-email">{t("setSecondaryEmailLabel")}</Label>
                <Input
                  id="admin-sec-email"
                  type="email"
                  value={secEmail}
                  onChange={(e) => setSecEmail(e.target.value)}
                  placeholder={user.secondaryEmail ?? "email@example.com"}
                />
              </div>
              <Button
                variant="outline"
                disabled={!secEmail.includes("@") || secSending}
                onClick={handleSetSecondaryEmail}
              >
                {secSending ? t("sending") : user.secondaryEmail ? t("change") : t("setEmail")}
              </Button>
            </div>
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}
