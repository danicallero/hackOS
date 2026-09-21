"use client";

// Form metadata editor (H11): trilingual name/description, window, limits.

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarClockIcon,
  ChevronDownIcon,
  InfoIcon,
  type LucideIcon,
  SettingsIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { MultiSelect } from "@/components/common/multi-select";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { toast } from "@/lib/toast";
import type { RoleSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { type ApplicationForm, fromLocalInput, toLocalInput } from "../lib";

// Runtime validator is built inside the component with useMemo so its error
// message can be localized via t("required"). Type is defined separately.
type MetaValues = {
  name: string;
  description: string;
  open_at: string;
  close_at: string;
  capacity: string;
  confirmation_window_hours: string;
  ask_shirt_size: boolean;
  ask_food_intolerances: boolean;
  grants_role_ids: string[];
};

function SettingsGroup({
  icon: Icon,
  title,
  defaultOpen = false,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("rounded-xl border bg-muted/20", className)}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-xs">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{title}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border border-t px-4 py-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function MetadataCard({
  form,
  onSaved,
  onDirtyChange,
}: {
  form: ApplicationForm;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const localizedMetaSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        description: z.string(),
        open_at: z.string(),
        close_at: z.string(),
        capacity: z.string(),
        confirmation_window_hours: z.string(),
        ask_shirt_size: z.boolean(),
        ask_food_intolerances: z.boolean(),
        grants_role_ids: z.array(z.string()),
      }),
    [t],
  );
  const rhf = useForm<MetaValues>({
    resolver: zodResolver(localizedMetaSchema),
    defaultValues: {
      name: form.name,
      description: form.description ?? "",
      open_at: toLocalInput(form.open_at),
      close_at: toLocalInput(form.close_at),
      capacity: form.capacity != null ? String(form.capacity) : "",
      confirmation_window_hours: String(form.confirmation_window_hours),
      ask_shirt_size: form.ask_shirt_size,
      ask_food_intolerances: form.ask_food_intolerances,
      grants_role_ids: form.grants_role_ids.map(String),
    },
  });

  useEffect(() => {
    // A protected role (system:superadmin today, CLI-only, H8) is never
    // offerable as a grantable role — the assign route would 403 it anyway.
    api
      .get<RoleSummary[]>("/api/roles")
      .then((r) => setRoles(r.filter((role) => !role.isProtected)))
      .catch(() => setRoles([]));
  }, []);

  useEffect(() => {
    onDirtyChange?.(rhf.formState.isDirty);
  }, [rhf.formState.isDirty, onDirtyChange]);

  async function onSubmit(values: MetaValues) {
    const capacityNum = values.capacity.trim() ? Number(values.capacity) : null;
    if (capacityNum !== null && (!Number.isInteger(capacityNum) || capacityNum < 1)) {
      rhf.setError("capacity", { message: t("mustBePositiveWholeNumber") });
      return;
    }
    const windowHours = Number(values.confirmation_window_hours);
    if (!Number.isInteger(windowHours) || windowHours < 1) {
      rhf.setError("confirmation_window_hours", { message: t("mustBePositiveWholeNumber") });
      return;
    }
    try {
      setSaveState("saving");
      // PATCH /api/applications/:id (APPLICATIONS_MANAGE) — audited server-side (H11/H53).
      await api.patch<ApplicationForm>(`/api/applications/${form.id}`, {
        name: values.name.trim(),
        description: values.description.trim() || null,
        open_at: fromLocalInput(values.open_at),
        close_at: fromLocalInput(values.close_at),
        capacity: capacityNum,
        confirmation_window_hours: windowHours,
        ask_shirt_size: values.ask_shirt_size,
        ask_food_intolerances: values.ask_food_intolerances,
        grants_role_ids: values.grants_role_ids.map(Number),
      });
      await onSaved();
      rhf.reset(values);
      setSaveState("saved");
      toast.success(t("formUpdated"));
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveForm"));
    }
  }

  const currentSaveState: SaveState = rhf.formState.isSubmitting
    ? "saving"
    : saveState === "error"
      ? "error"
      : rhf.formState.isDirty
        ? "unsaved"
        : "saved";

  return (
    <Form {...rhf}>
      <form onSubmit={rhf.handleSubmit(onSubmit)}>
        <SectionCard
          icon={SettingsIcon}
          title={t("formSettings")}
          state={<SaveStatus state={currentSaveState} />}
          bodyClassName="p-4 sm:p-5"
          footerClassName="sticky bottom-0 z-10 border-t bg-card/95 pt-4"
          footer={
            <SubmitButton pending={rhf.formState.isSubmitting}>{t("saveSettings")}</SubmitButton>
          }
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <SettingsGroup
              icon={InfoIcon}
              title={t("builderBasics")}
              defaultOpen
              className="lg:col-span-2"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={rhf.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("name")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={rhf.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("descriptionLabel")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={2}
                          placeholder={t("shownToApplicantsPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SettingsGroup>

            <SettingsGroup
              icon={CalendarClockIcon}
              title={t("builderAvailability")}
              defaultOpen
              className="lg:col-span-2"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={rhf.control}
                  name="open_at"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("colOpens")}</FormLabel>
                      <FormControl>
                        <DateTimeInput
                          value={field.value}
                          onChange={field.onChange}
                          nullOption={{ label: t("openImmediately") }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={rhf.control}
                  name="close_at"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("colCloses")}</FormLabel>
                      <FormControl>
                        <DateTimeInput
                          value={field.value}
                          onChange={field.onChange}
                          nullOption={{ label: t("neverCloses") }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={rhf.control}
                  name="capacity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("colQuota")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          placeholder={t("unlimitedPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={rhf.control}
                  name="confirmation_window_hours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("confirmWindowLabel")}</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SettingsGroup>

            <SettingsGroup
              icon={UsersIcon}
              title={t("builderLogistics")}
              defaultOpen={form.ask_shirt_size || form.ask_food_intolerances}
            >
              <div className="space-y-3">
                <FormField
                  control={rhf.control}
                  name="ask_shirt_size"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-4 rounded-lg border bg-background/70 p-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <FormLabel className="font-normal">{t("askShirtSizeLabel")}</FormLabel>
                        {field.value && (
                          <StatusBadge tone="neutral" dot={false}>
                            {t("requiredAtSubmitBadge")}
                          </StatusBadge>
                        )}
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={rhf.control}
                  name="ask_food_intolerances"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-4 rounded-lg border bg-background/70 p-3">
                      <FormLabel className="font-normal">{t("askFoodIntolerancesLabel")}</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </SettingsGroup>

            <SettingsGroup
              icon={ShieldCheckIcon}
              title={t("builderAccess")}
              defaultOpen={form.has_confirmed_responses || form.grants_role_ids.length > 0}
            >
              <FormField
                control={rhf.control}
                name="grants_role_ids"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("grantsRolesLabel")}</FormLabel>
                    <FormControl>
                      <MultiSelect
                        options={roles.map((role) => ({
                          value: String(role.id),
                          label: role.name,
                        }))}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={t("grantsRolesPlaceholder")}
                        searchPlaceholder={t("searchRolesPlaceholder")}
                        emptyText={t("noRolesYet")}
                      />
                    </FormControl>
                    {form.has_confirmed_responses && (
                      <Alert>
                        <InfoIcon aria-hidden="true" />
                        <AlertDescription>{t("grantsRolesNotRetroactiveNotice")}</AlertDescription>
                      </Alert>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SettingsGroup>
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}

export function ApplicationDangerZone({ onDelete }: { onDelete: () => void }) {
  const { t } = useLocale();

  return (
    <SectionCard
      leading={
        <TriangleAlertIcon aria-hidden="true" className="text-destructive mt-0.5 size-5 shrink-0" />
      }
      title={t("dangerZone")}
      className="border-destructive/30"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{t("deleteApplicationForm")}</h3>
          <p className="text-muted-foreground text-pretty text-sm">
            {t("deleteApplicationFormDesc")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="text-destructive sm:shrink-0"
          onClick={onDelete}
        >
          <Trash2Icon aria-hidden="true" />
          {t("deleteApplication")}
        </Button>
      </div>
    </SectionCard>
  );
}
