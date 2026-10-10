"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ShieldIcon } from "@phosphor-icons/react/dist/csr/Shield";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import Link from "next/link";
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
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
import { Section } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
import { useFoodIntolerances } from "@/hooks/use-food-intolerances";
import { useShirtSizes } from "@/hooks/use-shirt-sizes";
import { ApiError, api } from "@/lib/api";
import { languageName, type MessageKey, pickText, type Translate, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Intolerance, Language, Me } from "@/lib/types";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";
import { capabilitiesByDomain, prettifyCapability } from "../../permissions/helpers";
import { DangerZoneCard } from "./danger-zone";
import { EmailCard } from "./email-card";
import { MealsSection } from "./meals-section";
import { PasswordCard } from "./password-card";
import { ProfilePhoto } from "./profile-photo";
import { PublicProfileCard } from "./public-profile-card";

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

const CAPABILITY_DOMAIN_LABELS: Record<string, MessageKey> = {
  users: "users",
  permissions: "permissions",
  invites: "capabilityAreaInvites",
  applications: "applications",
  statistics: "capabilityAreaStatistics",
  projects: "projects",
  accredit: "accreditation",
  presence: "presence",
  activity: "activities",
  logistics: "logistics",
  intolerances: "foodIntolerances",
  queue: "queueOperations",
  judge: "judges",
  judging: "judging",
  sponsors: "sponsors",
  challenges: "challenges",
  schedule: "schedule",
  announcements: "announcements",
  tv: "tvControl",
  event: "eventSettings",
  venue: "toastVenueSettings",
  wallet: "wallet",
  notifications: "toastNotificationSettings",
  audit: "auditLog",
  exports: "capabilityAreaExports",
};

function capabilityDomainLabel(domain: string, t: Translate): string {
  const key = CAPABILITY_DOMAIN_LABELS[domain];
  return key ? t(key) : prettifyCapability(domain, t);
}

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

export default function ProfileSettingsPage() {
  const { me } = useSessionContext();
  // Dictionary options for the picker (H12/H25).
  const intolerances = useFoodIntolerances();

  if (!me) return null;

  // Keyed by user id so the form (and its Radix Selects) mounts fresh with
  // the right defaultValues instead of flipping value post-mount via reset()
  // — a post-mount value change on a Select whose options were never
  // rendered (dropdown never opened) gets silently clobbered back to "" by
  // Radix's hidden native-select sync (H-web settings prefill fix).
  return <ProfileForm key={me.id} me={me} intolerances={intolerances} />;
}

function ProfileForm({ me, intolerances }: { me: Me; intolerances: Intolerance[] }) {
  const { refresh } = useSessionContext();
  const { t } = useLocale();
  const lang = (me.language as Language) ?? "es";
  const schema = useMemo(() => profileSchema(t), [t]);
  const shirtSizes = useShirtSizes();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: valuesFromMe(me),
  });
  // H7: name and logistics data (shirt size, dietary info) are locked once
  // an application is accepted — staff can still fix them via the user detail page.
  const locked = me.profileLocked;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mealsDirty, setMealsDirty] = useState(false);
  const onMealsDirtyChange = useCallback((dirty: boolean) => setMealsDirty(dirty), []);
  useUnsavedChangesGuard(form.formState.isDirty || mealsDirty);
  const noRestrictions = form.watch("noRestrictions");
  // Restored when "No restrictions" is unticked again.
  const dietaryBeforeNone = useRef({ foodIntolerances: [] as string[], foodIntoleranceNotes: "" });

  async function onSubmit(values: Values) {
    setSaveError(null);
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
      setSaveError(err instanceof ApiError ? err.message : t("couldNotSaveProfile"));
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotSaveProfile"),
        t("toastSaveProfile"),
      );
    }
  }

  const intoleranceOptions = intolerances.map((i) => ({
    value: String(i.id),
    label: pickText(i.label, lang),
    description: i.description ? pickText(i.description, lang) : undefined,
  }));

  return (
    <PageLayout width="content">
      <PageHeader title={t("myProfile")} />
      <div className="grid items-start gap-(--space-between-sections) xl:grid-cols-2">
        <Form {...form}>
          <form className="min-w-0" onSubmit={form.handleSubmit(onSubmit)}>
            <SectionCard
              footerClassName="justify-start"
              icon={UserIcon}
              title={t("personalDetails")}
              description={locked ? t("profileLockedNotice") : undefined}
              stickyFooter
              footer={
                <FormActions
                  pending={form.formState.isSubmitting}
                  state={saveError ? "error" : form.formState.isDirty ? "unsaved" : "saved"}
                />
              }
            >
              {saveError && <ContextualError message={saveError} />}
              <ProfilePhoto />
              <div className="grid items-start gap-4 sm:grid-cols-2">
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
                        disabled={locked || noRestrictions}
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
                        disabled={locked || noRestrictions}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="noRestrictions"
                render={({ field }) => (
                  <FormItem className="flex flex-wrap items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        disabled={locked}
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
                            form.setValue(
                              "foodIntoleranceNotes",
                              before.foodIntoleranceNotes,
                              opts,
                            );
                          }
                        }}
                      />
                    </FormControl>
                    <FormLabel className="font-normal">{t("noRestrictions")}</FormLabel>
                    <FormMessage className="basis-full" />
                  </FormItem>
                )}
              />
            </SectionCard>
          </form>
        </Form>
        <div className="min-w-0 space-y-(--space-between-sections)">
          {me.isSponsorRep && <MealsSection userId={me.id} onDirtyChange={onMealsDirtyChange} />}
          <EmailCard />
          <PasswordCard />
        </div>
      </div>
      <PublicProfileCard />
      {me.roles.length > 0 && <ProfileRoles me={me} />}
      <DangerZoneCard />
      <nav
        aria-label={t("legalLinksLabel")}
        className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm"
      >
        <Link className="underline underline-offset-4 hover:text-foreground" href="/terms">
          {t("termsAndConditions")}
        </Link>
        <Link className="underline underline-offset-4 hover:text-foreground" href="/privacy">
          {t("privacyPolicy")}
        </Link>
      </nav>
    </PageLayout>
  );
}

function ProfileRoles({ me }: { me: Me }) {
  const { t } = useLocale();
  const visibleRoleId = me.roles.find((role) => role.isVisible)?.id;
  const hasAllCapabilities = me.capabilities.includes(CAPABILITIES.ADMIN_ALL);
  const effectiveSet = new Set<string>(me.capabilities);
  const capabilityGroups = capabilitiesByDomain()
    .map((group) => ({
      ...group,
      capabilities: group.capabilities.filter(
        (capability) =>
          capability !== CAPABILITIES.ADMIN_ALL &&
          (hasAllCapabilities || effectiveSet.has(capability)),
      ),
    }))
    .filter((group) => group.capabilities.length > 0);
  const headingId = useId();
  const detailsId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const summaryRef = useRef<HTMLButtonElement>(null);
  const collapseAnchorY = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (isExpanded || collapseAnchorY.current === null) return;
    const summary = summaryRef.current;
    if (summary) {
      const delta = summary.getBoundingClientRect().top - collapseAnchorY.current;
      if (delta !== 0) window.scrollBy(0, delta);
    }
    collapseAnchorY.current = null;
  }, [isExpanded]);

  return (
    <Section padding="none" aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        {t("rolesTitle")}
      </h2>
      <button
        ref={summaryRef}
        type="button"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        aria-labelledby={`${headingId} ${detailsId}-summary`}
        onClick={() => {
          if (isExpanded) {
            collapseAnchorY.current = summaryRef.current?.getBoundingClientRect().top ?? null;
          }
          setIsExpanded((expanded) => !expanded);
        }}
        className={`button-interaction flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-t-surface px-4 py-3 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5 ${isExpanded ? "sticky top-16 z-10 bg-card md:top-0" : ""}`}
      >
        <ShieldIcon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span aria-hidden="true" className="type-section-title block">
            {t("rolesTitle")}
          </span>
          <span
            id={`${detailsId}-summary`}
            className="text-muted-foreground block min-w-0 wrap-anywhere text-sm"
          >
            <span>{t("visibleRole")}: </span>
            <span className="font-medium text-foreground">
              {me.visibleRoleName ?? t("roleUnassigned")}
            </span>
          </span>
        </span>
        <span className="text-muted-foreground hidden shrink-0 text-sm sm:inline">
          {isExpanded ? t("hideRoleDetails") : t("showRoleDetails")}
        </span>
        <CaretRightIcon
          aria-hidden="true"
          className={`text-muted-foreground size-4 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
        />
      </button>
      <div
        id={detailsId}
        hidden={!isExpanded}
        className="space-y-5 border-t border-border/60 p-4 sm:p-5"
      >
        <section className="space-y-2">
          <h3 className="type-label text-muted-foreground">{t("assignedRoles")}</h3>
          <ol className="divide-y divide-border/60">
            {me.roles.map((role) => (
              <li
                key={role.id}
                className="flex min-w-0 flex-wrap items-center gap-2 py-2 text-sm first:pt-0 last:pb-0"
              >
                <span className="min-w-0 wrap-anywhere">{role.name}</span>
                {role.id === visibleRoleId && <Badge variant="outline">{t("visibleRole")}</Badge>}
              </li>
            ))}
          </ol>
        </section>
        <section className="space-y-3 border-t border-border/60 pt-4">
          <h3 className="type-label text-muted-foreground">{t("effectiveCapabilities")}</h3>
          {capabilityGroups.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noCapabilities")}</p>
          ) : (
            <div className="grid gap-x-6 sm:grid-cols-2">
              {capabilityGroups.map((group) => (
                <details key={group.domain} className="group border-t border-border/60">
                  <summary className="button-interaction flex min-h-11 w-full cursor-pointer list-none items-center gap-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                    <h4 className="min-w-0 flex-1 text-sm font-medium">
                      {capabilityDomainLabel(group.domain, t)}
                    </h4>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {group.capabilities.length}
                    </span>
                    <CaretRightIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90"
                    />
                  </summary>
                  <div className="flex flex-wrap gap-1.5 pb-3">
                    {group.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded-control border border-border/60 px-2 py-1 text-xs"
                      >
                        {prettifyCapability(capability, t)}
                      </span>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </Section>
  );
}
