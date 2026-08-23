"use client";

import { ChevronDownIcon, MegaphoneIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { fromDatetimeLocal, getTimeZoneLabel } from "@/lib/datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementInput,
  NotificationChannel,
} from "@/lib/notifications";
import { notificationsApi } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const AUDIENCES: AnnouncementAudience[] = ["sponsor", "participant", "mentor", "staff"];
const CHANNELS: NotificationChannel[] = ["in_app", "email", "push"];

function audienceLabel(audience: AnnouncementAudience, t: Translate): string {
  const map: Record<AnnouncementAudience, string> = {
    sponsor: t("audienceSponsor"),
    participant: t("audienceParticipant"),
    mentor: t("audienceMentor"),
    staff: t("audienceStaff"),
  };
  return map[audience];
}

function channelLabel(channel: NotificationChannel, t: Translate): string {
  const map: Record<NotificationChannel, string> = {
    in_app: t("channelInApp"),
    email: t("email"),
    push: t("channelPush"),
  };
  return map[channel];
}

type TargetingMode = "everyone" | "audience" | "specific";

function targetingModeOf(values: AnnouncementInput): TargetingMode {
  if (values.recipientUserIds.length > 0) return "specific";
  if (values.audiences.length > 0) return "audience";
  return "everyone";
}

export const EMPTY_ANNOUNCEMENT_FORM: AnnouncementInput = {
  title: "",
  body: "",
  translations: {
    es: { title: "", body: "" },
    gl: { title: "", body: "" },
    en: { title: "", body: "" },
  },
  notifyUsers: false,
  screenPlacement: "none",
  publishAt: null,
  expiresAt: null,
  audiences: [],
  channels: ["in_app", "email", "push"],
  recipientUserIds: [],
};

export function announcementToForm(a: Announcement): AnnouncementInput {
  return {
    title: a.title,
    body: a.body,
    translations: {
      es: a.translations?.es ?? { title: a.title, body: a.body },
      gl: a.translations?.gl ?? { title: "", body: "" },
      en: a.translations?.en ?? { title: "", body: "" },
    },
    notifyUsers: a.notify_users,
    screenPlacement: a.screen_placement,
    publishAt: a.publish_at,
    expiresAt: a.expires_at,
    audiences: a.audiences ?? [],
    channels: a.channels ?? ["in_app", "email", "push"],
    recipientUserIds: (a.recipients ?? []).map((r) => r.id),
  };
}

/**
 * Form modal for creating or editing announcements.
 * Handles trilingual content, scheduling, channel delivery, and audience targeting.
 * Must be used with a `key` prop that changes when the entity changes (create vs. edit with different IDs) to reset form state on remount.
 */
export function AnnouncementFormModal({
  open,
  onOpenChange,
  title,
  initial,
  initialRecipients,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial: AnnouncementInput;
  /** Display info for `initial.recipientUserIds`, when editing (edit-mode hydration). */
  initialRecipients?: UserOption[];
  submitLabel: string;
  onSubmit: (values: AnnouncementInput) => Promise<void>;
}) {
  const { t } = useLocale();
  const [values, setValues] = useState(initial);
  const [recipients, setRecipients] = useState<UserOption[]>(initialRecipients ?? []);
  // Tracked as its own state rather than derived from audiences/recipientUserIds:
  // picking "By audience" or "Specific people" starts with an empty
  // selection, and a purely-derived mode would immediately snap back to
  // "everyone" the moment those arrays are empty, making the mode
  // unselectable in the first place.
  const [targetingMode, setTargetingModeState] = useState<TargetingMode>(targetingModeOf(initial));
  const [pending, setPending] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  // Hidden by default: only shown once the availability check confirms a
  // provider is configured, so the form works identically (manual entry
  // only) on a deployment with no translation provider at all.
  const [translateAvailable, setTranslateAvailable] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);

  // Check translation provider availability on mount (only once per session, not per entity)
  useEffect(() => {
    let cancelled = false;
    notificationsApi
      .translateAvailability()
      .then((result) => {
        if (!cancelled) setTranslateAvailable(result.available);
      })
      .catch(() => {
        if (!cancelled) setTranslateAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Staff can write the primary content in whichever of the three languages
   * comes naturally, not just Spanish — this picks the first non-empty
   * language as the source and fills every still-empty one from it. Never
   * overwrites a field someone already typed into, in any language.
   */
  async function autoTranslate() {
    const content: Record<"es" | "gl" | "en", { title: string; body: string }> = {
      es: { title: values.title, body: values.body },
      gl: values.translations.gl,
      en: values.translations.en,
    };
    const isFilled = (language: "es" | "gl" | "en") =>
      Boolean(content[language].title.trim() && content[language].body.trim());
    const source = (["es", "gl", "en"] as const).find(isFilled);
    const targets = (["es", "gl", "en"] as const).filter((language) => !isFilled(language));
    if (!source || targets.length === 0) return;
    setTranslating(true);
    try {
      const { translations } = await notificationsApi.translateAnnouncement({
        title: content[source].title,
        body: content[source].body,
        sourceLanguage: source,
        targetLanguages: targets,
      });
      setValues((v) => {
        const nextTranslations = { ...v.translations, ...translations };
        return {
          ...v,
          title: translations.es?.title ?? v.title,
          body: translations.es?.body ?? v.body,
          translations: nextTranslations,
        };
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotTranslate"));
    } finally {
      setTranslating(false);
    }
  }

  const canAutoTranslate =
    (Boolean(values.title.trim()) && Boolean(values.body.trim())) ||
    (Boolean(values.translations.gl.title.trim()) && Boolean(values.translations.gl.body.trim())) ||
    (Boolean(values.translations.en.title.trim()) && Boolean(values.translations.en.body.trim()));

  const invalidWindow =
    Boolean(values.publishAt) &&
    Boolean(values.expiresAt) &&
    new Date(values.expiresAt as string).getTime() <=
      new Date(values.publishAt as string).getTime();

  const canTargetSpecific = values.screenPlacement === "none";

  function setTargetingMode(mode: TargetingMode) {
    setTargetingModeState(mode);
    setValues((v) => ({
      ...v,
      audiences: mode === "audience" ? v.audiences : [],
      recipientUserIds: mode === "specific" ? v.recipientUserIds : [],
    }));
    if (mode !== "specific") setRecipients([]);
  }

  function toggleAudience(audience: AnnouncementAudience, checked: boolean) {
    setValues((v) => {
      const current = new Set(v.audiences);
      if (checked) current.add(audience);
      else current.delete(audience);
      return { ...v, audiences: Array.from(current) };
    });
  }

  function toggleChannel(channel: NotificationChannel, checked: boolean) {
    setValues((v) => {
      const current = new Set(v.channels);
      if (checked) current.add(channel);
      else current.delete(channel);
      return { ...v, channels: Array.from(current) };
    });
  }

  async function searchRecipients(query: string): Promise<UserOption[]> {
    if (query.trim().length < 2) return [];
    try {
      const result = await notificationsApi.recipientCandidates(query);
      const existing = new Set(values.recipientUserIds);
      return result.users.filter((u) => !existing.has(u.id));
    } catch {
      toast.error(t("searchFailed"));
      return [];
    }
  }

  function addRecipient(user: UserOption) {
    if (values.recipientUserIds.includes(user.id)) return;
    setValues((v) => ({ ...v, recipientUserIds: [...v.recipientUserIds, user.id] }));
    setRecipients((r) => [...r, user]);
  }

  function removeRecipient(userId: number) {
    setValues((v) => ({
      ...v,
      recipientUserIds: v.recipientUserIds.filter((id) => id !== userId),
    }));
    setRecipients((r) => r.filter((u) => u.id !== userId));
  }

  async function submit() {
    const publishAt = values.publishAt ? fromDatetimeLocal(values.publishAt) : null;
    const expiresAt = values.expiresAt ? fromDatetimeLocal(values.expiresAt) : null;
    if ((values.publishAt && !publishAt) || (values.expiresAt && !expiresAt)) {
      toast.error(t("enterValidDatesTimes"));
      return;
    }
    if (invalidWindow) {
      document.getElementById("announcement-expires-at")?.focus();
      return;
    }
    const languages = ["es", "gl", "en"] as const;
    const completeLanguages = languages.filter((language) => {
      const translation = values.translations[language];
      return Boolean(translation.title.trim() && translation.body.trim());
    });
    const incompleteLanguage = languages.find((language) => {
      const translation = values.translations[language];
      const hasContent = Boolean(translation.title.trim() || translation.body.trim());
      const isComplete = Boolean(translation.title.trim() && translation.body.trim());
      return hasContent && !isComplete;
    });
    if (completeLanguages.length === 0 || incompleteLanguage) {
      setContentError(t("announcementTranslationsRequired"));
      const firstInvalidLanguage = incompleteLanguage ?? languages[0];
      const titleId =
        firstInvalidLanguage === "es"
          ? "announcement-title"
          : `announcement-title-${firstInvalidLanguage}`;
      const bodyId =
        firstInvalidLanguage === "es"
          ? "announcement-body"
          : `announcement-body-${firstInvalidLanguage}`;
      document
        .getElementById(!values.translations[firstInvalidLanguage].title.trim() ? titleId : bodyId)
        ?.focus();
      return;
    }
    const translations = Object.fromEntries(
      completeLanguages.map((language) => [language, values.translations[language]]),
    ) as AnnouncementInput["translations"];
    const primaryLanguage = completeLanguages[0];
    const primary = values.translations[primaryLanguage];
    setContentError(null);
    setPending(true);
    try {
      await onSubmit({
        ...values,
        title: primary.title.trim(),
        body: primary.body.trim(),
        translations,
        publishAt,
        expiresAt: values.screenPlacement === "none" ? null : expiresAt,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveAnnouncement"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} icon={MegaphoneIcon} size="xl">
      <div className="space-y-6">
        <SectionCard title={t("announcementContentSection")}>
          <div className="space-y-4">
            <Field id="announcement-title" label={`${t("titleLabel")} · ${t("spanishTag")}`}>
              <Input
                id="announcement-title"
                value={values.title}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    title: e.target.value,
                    translations: {
                      ...v.translations,
                      es: { ...v.translations.es, title: e.target.value },
                    },
                  }))
                }
                placeholder={t("dinnerReadyPlaceholder")}
                aria-invalid={Boolean(contentError)}
                aria-describedby={contentError ? "announcement-content-error" : undefined}
              />
            </Field>
            <Field id="announcement-body" label={`${t("messageLabel")} · ${t("spanishTag")}`}>
              <Textarea
                id="announcement-body"
                rows={4}
                value={values.body}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    body: e.target.value,
                    translations: {
                      ...v.translations,
                      es: { ...v.translations.es, body: e.target.value },
                    },
                  }))
                }
                placeholder={t("headToMainHallPlaceholder")}
                aria-invalid={Boolean(contentError)}
                aria-describedby={contentError ? "announcement-content-error" : undefined}
              />
            </Field>
            <Collapsible open={translationsOpen} onOpenChange={setTranslationsOpen}>
              <div className="flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex min-h-10 items-center gap-2 text-sm font-medium"
                    aria-label={t("translationsAndSettings")}
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-4 transition-transform",
                        translationsOpen && "rotate-180",
                      )}
                    />
                    {t("translationsAndSettings")}
                  </button>
                </CollapsibleTrigger>
                {translateAvailable ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={translating || !canAutoTranslate}
                    onClick={() => void autoTranslate()}
                  >
                    {translating ? t("translatingInProgress") : t("translateAutomatically")}
                  </Button>
                ) : null}
              </div>
              <CollapsibleContent className="rounded-b-lg border border-t-0 px-4 pt-3 pb-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {(["gl", "en"] as const).map((language) => (
                    <div key={language} className="grid gap-3">
                      <Field
                        id={`announcement-title-${language}`}
                        label={`${t("titleLabel")} · ${t(language === "gl" ? "galicianTag" : "englishTag")}`}
                      >
                        <Input
                          id={`announcement-title-${language}`}
                          value={values.translations[language].title}
                          aria-invalid={Boolean(contentError)}
                          aria-describedby={contentError ? "announcement-content-error" : undefined}
                          onChange={(event) =>
                            setValues((v) => ({
                              ...v,
                              translations: {
                                ...v.translations,
                                [language]: {
                                  title: event.target.value,
                                  body: v.translations[language].body,
                                },
                              },
                            }))
                          }
                        />
                      </Field>
                      <Field
                        id={`announcement-body-${language}`}
                        label={`${t("messageLabel")} · ${t(language === "gl" ? "galicianTag" : "englishTag")}`}
                      >
                        <Textarea
                          id={`announcement-body-${language}`}
                          rows={3}
                          value={values.translations[language].body}
                          aria-invalid={Boolean(contentError)}
                          aria-describedby={contentError ? "announcement-content-error" : undefined}
                          onChange={(event) =>
                            setValues((v) => ({
                              ...v,
                              translations: {
                                ...v.translations,
                                [language]: {
                                  title: v.translations[language].title,
                                  body: event.target.value,
                                },
                              },
                            }))
                          }
                        />
                      </Field>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
            {contentError && (
              <p id="announcement-content-error" className="text-destructive text-sm" role="alert">
                {contentError}
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard title={t("announcementDeliverySection")}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="announcement-notify-users">{t("announcementNotifyUsers")}</Label>
                  <Switch
                    id="announcement-notify-users"
                    checked={values.notifyUsers}
                    onCheckedChange={(notifyUsers) => setValues((v) => ({ ...v, notifyUsers }))}
                  />
                </div>
                <p className="text-muted-foreground mt-2 text-sm text-pretty">
                  {t("announcementNotifyUsersHelp")}
                </p>
              </div>
              <Field id="announcement-screen-placement" label={t("announcementScreenPlacement")}>
                <Select
                  value={values.screenPlacement}
                  onValueChange={(screenPlacement) => {
                    // Screen-placed announcements can't target specific recipients (H50).
                    if (screenPlacement !== "none" && targetingMode === "specific") {
                      setTargetingModeState("everyone");
                      setRecipients([]);
                    }
                    setValues((v) => ({
                      ...v,
                      screenPlacement: screenPlacement as AnnouncementInput["screenPlacement"],
                      recipientUserIds: screenPlacement === "none" ? v.recipientUserIds : [],
                    }));
                  }}
                >
                  <SelectTrigger id="announcement-screen-placement" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("announcementPlacementNone")}</SelectItem>
                    <SelectItem value="embedded">{t("announcementPlacementEmbedded")}</SelectItem>
                    <SelectItem value="fullscreen">
                      {t("announcementPlacementFullscreen")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {values.notifyUsers && (
              <>
                <Field id="announcement-channels" label={t("announcementChannelsLabel")}>
                  <div className="flex flex-wrap gap-4">
                    {CHANNELS.map((channel) => (
                      <div key={channel} className="flex items-center gap-2">
                        <Checkbox
                          id={`announcement-channel-${channel}`}
                          checked={values.channels.includes(channel)}
                          onCheckedChange={(checked) => toggleChannel(channel, checked === true)}
                        />
                        <Label htmlFor={`announcement-channel-${channel}`} className="font-normal">
                          {channelLabel(channel, t)}
                        </Label>
                      </div>
                    ))}
                  </div>
                </Field>

                <Field id="announcement-targeting" label={t("announcementTargetingLabel")}>
                  <Select
                    value={targetingMode}
                    onValueChange={(mode) => setTargetingMode(mode as TargetingMode)}
                  >
                    <SelectTrigger id="announcement-targeting" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="everyone">{t("announcementTargetingEveryone")}</SelectItem>
                      <SelectItem value="audience">{t("announcementTargetingAudience")}</SelectItem>
                      <SelectItem value="specific" disabled={!canTargetSpecific}>
                        {t("announcementTargetingSpecific")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {!canTargetSpecific && (
                    <p className="text-muted-foreground text-sm text-pretty">
                      {t("announcementScreenTargetingDisabledHint")}
                    </p>
                  )}
                </Field>

                {targetingMode === "audience" && (
                  <div className="flex flex-wrap gap-4">
                    {AUDIENCES.map((audience) => (
                      <div key={audience} className="flex items-center gap-2">
                        <Checkbox
                          id={`announcement-audience-${audience}`}
                          checked={values.audiences.includes(audience)}
                          onCheckedChange={(checked) => toggleAudience(audience, checked === true)}
                        />
                        <Label
                          htmlFor={`announcement-audience-${audience}`}
                          className="font-normal"
                        >
                          {audienceLabel(audience, t)}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}

                {targetingMode === "specific" && (
                  <div className="space-y-3">
                    <UserPicker
                      id="announcement-recipient-picker"
                      value=""
                      onChange={(_value, user) => {
                        if (user) addRecipient(user);
                      }}
                      search={searchRecipients}
                      minQueryLength={2}
                      inDialog
                    />
                    {recipients.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t("announcementNoRecipientsYet")}
                      </p>
                    ) : (
                      <ul className="divide-border divide-y">
                        {recipients.map((user) => (
                          <li
                            key={user.id}
                            className="flex items-center justify-between gap-2 py-2"
                          >
                            <span className="text-sm">
                              {[user.name, user.surname].filter(Boolean).join(" ").trim() ||
                                user.email}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t("remove")}
                              onClick={() => removeRecipient(user.id)}
                            >
                              <XIcon className="size-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </SectionCard>

        <SectionCard title={t("announcementPublicationSection")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="announcement-publish-at"
              label={
                values.screenPlacement === "none" ? t("announcementSendAtLabel") : t("visibleFrom")
              }
            >
              <DateTimeInput
                id="announcement-publish-at"
                value={values.publishAt ?? ""}
                onChange={(publishAt) => setValues((v) => ({ ...v, publishAt: publishAt || null }))}
                nullOption={{ label: t("immediatelyLabel") }}
              />
              <p className="text-muted-foreground text-sm text-pretty">
                {t("publishDestinationsHint", { timezone: getTimeZoneLabel() })}
              </p>
            </Field>
            {values.screenPlacement !== "none" ? (
              <Field id="announcement-expires-at" label={t("visibleUntil")}>
                <DateTimeInput
                  id="announcement-expires-at"
                  value={values.expiresAt ?? ""}
                  onChange={(expiresAt) =>
                    setValues((v) => ({ ...v, expiresAt: expiresAt || null }))
                  }
                  nullOption={{ label: t("noEnd") }}
                />
              </Field>
            ) : (
              <p className="text-muted-foreground self-end text-sm text-pretty">
                {t("announcementNotifyOnlyHint")}
              </p>
            )}
          </div>
          {invalidWindow && (
            <p className="text-destructive mt-4 text-sm" role="alert">
              {t("endTimeAfterStart")}
            </p>
          )}
        </SectionCard>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <SubmitButton pending={pending} onClick={submit} disabled={!values.title}>
            {submitLabel}
          </SubmitButton>
        </div>
      </div>
    </Modal>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
