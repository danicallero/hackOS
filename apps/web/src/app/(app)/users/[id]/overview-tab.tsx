"use client";

// Profile overview: read-only for most viewers, an edit form for staff.
// Dietary and intolerance fields are privacy-sensitive — see privacy-removal.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertModal } from "@/components/common/alert-modal";
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
import { useShirtSizes } from "@/hooks/use-shirt-sizes";
import { ApiError, api } from "@/lib/api";
import { isLanguage, LANGS, languageName, pickText, useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { Intolerance, Language, UserDetail } from "@/lib/types";

const editSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  surname: z.string().min(1, "Required").max(200),
  language: z.enum(["en", "es", "gl"]),
  shirtSize: z.string(),
  dni: z.string().max(50),
  foodIntolerances: z.array(z.string()),
  foodIntoleranceNotes: z.string().max(2000),
  notes: z.string().max(4000),
});
type EditValues = z.infer<typeof editSchema>;
const NONE = "__none__";

export function OverviewTab({
  user,
  intolerances,
  onUpdated,
}: {
  user: UserDetail;
  intolerances: Intolerance[];
  onUpdated: () => Promise<void>;
}) {
  const canWrite = useCan(CAPABILITIES.USERS_WRITE);
  return (
    <div className="space-y-6">
      {canWrite ? (
        <StaffEditForm user={user} intolerances={intolerances} onUpdated={onUpdated} />
      ) : (
        <ReadOnlyOverview user={user} intolerances={intolerances} />
      )}
    </div>
  );
}

export function intoleranceNames(ids: number[], dict: Intolerance[], lang: Language): string {
  if (!ids.length) return "";
  const byId = new Map(dict.map((i) => [i.id, i]));
  return ids
    .map((id) => {
      const item = byId.get(id);
      return item ? pickText(item.label, lang) : `#${id}`;
    })
    .join(", ");
}

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className={empty ? "text-muted-foreground text-sm" : "text-sm"}>{empty ? "—" : value}</dd>
    </div>
  );
}

export function ReadOnlyOverview({
  user,
  intolerances,
}: {
  user: UserDetail;
  intolerances: Intolerance[];
}) {
  const { t } = useLocale();
  const lang = (LANGS.includes(user.language as Language) ? user.language : "es") as Language;
  return (
    <SectionCard icon={UserIcon} title={t("profileDetails")} bodyClassName="space-y-4">
      <dl className="space-y-4">
        <Field
          label={t("secondaryEmailLabel")}
          value={
            user.secondaryEmail ? (
              <span className="inline-flex items-center gap-2">
                {user.secondaryEmail}
                <StatusBadge tone={user.secondaryEmailVerified ? "success" : "warning"} dot={false}>
                  {user.secondaryEmailVerified ? t("verified") : t("pendingShort")}
                </StatusBadge>
              </span>
            ) : null
          }
        />
        <Field
          label={t("language")}
          value={isLanguage(user.language) ? languageName(user.language) : user.language}
        />
        <Field label={t("shirtSize")} value={user.shirtSize} />
        <Field
          label={t("foodIntolerances")}
          value={intoleranceNames(user.foodIntolerances, intolerances, lang)}
        />
        <Field label={t("dietaryNotesLabel")} value={user.foodIntoleranceNotes} />
        <Field label={t("dniLabel")} value={user.dni} />
      </dl>
    </SectionCard>
  );
}

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
  const shirtSizes = useShirtSizes();

  const localizedEditSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        surname: z.string().min(1, t("required")).max(200),
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
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [primarySending, setPrimarySending] = useState(false);

  async function onSubmit(values: EditValues) {
    try {
      await api.patch<UserDetail>(`/api/users/${user.id}`, {
        name: values.name,
        surname: values.surname,
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

  async function handleChangePrimaryEmail() {
    setPrimarySending(true);
    try {
      await api.patch(`/api/users/${user.id}/email`, {
        email: primaryEmail.trim().toLowerCase(),
      });
      toast.success(t("primaryEmailChanged"));
      setPrimaryEmail("");
      await onUpdated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotChangePrimaryEmail"));
    } finally {
      setPrimarySending(false);
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

  async function handleRemoveSecondaryEmail() {
    setSecSending(true);
    try {
      await api.delete(`/api/users/${user.id}/secondary-email`);
      toast.success(t("secondaryEmailRemoved"));
      await onUpdated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveSecondaryEmail"));
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
          <FormField
            control={form.control}
            name="dni"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("dniLabel")}</FormLabel>
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
            <h4 className="text-sm font-medium">{t("primaryEmailLabel")}</h4>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {t("currentEmailInline", { email: user.email })}
              </span>
              <StatusBadge tone={user.emailVerified ? "success" : "warning"} dot={false}>
                {user.emailVerified ? t("verified") : t("unverified")}
              </StatusBadge>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="admin-primary-email">{t("changePrimaryEmailLabel")}</Label>
                <Input
                  id="admin-primary-email"
                  type="email"
                  value={primaryEmail}
                  onChange={(e) => setPrimaryEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
              <AlertModal
                title={t("changePrimaryEmailTitle")}
                description={t("changePrimaryEmailStaffDesc", { email: primaryEmail.trim() })}
                cancelLabel={t("cancel")}
                confirmLabel={t("change")}
                autoClose
                pending={primarySending}
                trigger={
                  <Button variant="outline" disabled={!primaryEmail.includes("@")}>
                    {t("change")}
                  </Button>
                }
                onConfirm={handleChangePrimaryEmail}
              />
            </div>
          </div>
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
                <AlertModal
                  title={t("removeSecondaryEmailTitle")}
                  description={t("removeSecondaryEmailStaffDesc")}
                  cancelLabel={t("cancel")}
                  confirmLabel={t("remove")}
                  destructive
                  pending={secSending}
                  trigger={
                    <Button type="button" variant="outline" size="sm">
                      {t("remove")}
                    </Button>
                  }
                  onConfirm={handleRemoveSecondaryEmail}
                />
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
