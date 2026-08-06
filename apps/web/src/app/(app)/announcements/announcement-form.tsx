"use client";

import { MegaphoneIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DateTimeInput } from "@/components/common/datetime-input";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
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
import { useLocale } from "@/lib/i18n";
import type { Announcement, AnnouncementInput } from "@/lib/notifications";

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
  };
}

export function AnnouncementForm({
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: AnnouncementInput;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (values: AnnouncementInput) => Promise<void>;
}) {
  const { t } = useLocale();
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  useEffect(() => {
    setValues(initial);
    setDirty(false);
    setContentError(null);
  }, [initial]);

  function updateValues(updater: (current: AnnouncementInput) => AnnouncementInput) {
    setValues((current) => updater(current));
    setDirty(true);
  }

  const invalidWindow =
    Boolean(values.publishAt) &&
    Boolean(values.expiresAt) &&
    new Date(values.expiresAt as string).getTime() <=
      new Date(values.publishAt as string).getTime();

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
    const missingContent = (["es", "gl", "en"] as const).find(
      (language) =>
        !values.translations[language].title.trim() || !values.translations[language].body.trim(),
    );
    if (missingContent) {
      setContentError(t("announcementTranslationsRequired"));
      document
        .getElementById(
          !values.translations[missingContent].title.trim()
            ? `announcement-title-${missingContent}`
            : `announcement-body-${missingContent}`,
        )
        ?.focus();
      return;
    }
    setContentError(null);
    setPending(true);
    try {
      await onSubmit({ ...values, publishAt, expiresAt });
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveAnnouncement"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard icon={MegaphoneIcon} title={t("announcementContentSection")}>
        <div className="space-y-4">
          <Field id="announcement-title" label={`${t("titleLabel")} · ${t("spanishTag")}`}>
            <Input
              id="announcement-title"
              value={values.title}
              onChange={(e) =>
                updateValues((v) => ({
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
              rows={5}
              value={values.body}
              onChange={(e) =>
                updateValues((v) => ({
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
          <fieldset className="space-y-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">{t("translationsAndSettings")}</legend>
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
                        updateValues((v) => ({
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
                        updateValues((v) => ({
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
          </fieldset>
          {contentError && (
            <p id="announcement-content-error" className="text-destructive text-sm" role="alert">
              {contentError}
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard title={t("announcementDeliverySection")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="announcement-notify-users">{t("announcementNotifyUsers")}</Label>
              <Switch
                id="announcement-notify-users"
                checked={values.notifyUsers}
                onCheckedChange={(notifyUsers) => updateValues((v) => ({ ...v, notifyUsers }))}
              />
            </div>
            <p className="text-muted-foreground mt-2 text-sm text-pretty">
              {t("announcementNotifyUsersHelp")}
            </p>
          </div>
          <Field id="announcement-screen-placement" label={t("announcementScreenPlacement")}>
            <Select
              value={values.screenPlacement}
              onValueChange={(screenPlacement) =>
                updateValues((v) => ({
                  ...v,
                  screenPlacement: screenPlacement as AnnouncementInput["screenPlacement"],
                }))
              }
            >
              <SelectTrigger id="announcement-screen-placement" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("announcementPlacementNone")}</SelectItem>
                <SelectItem value="embedded">{t("announcementPlacementEmbedded")}</SelectItem>
                <SelectItem value="fullscreen">{t("announcementPlacementFullscreen")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title={t("announcementPublicationSection")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="announcement-publish-at" label={t("visibleFrom")}>
            <DateTimeInput
              id="announcement-publish-at"
              value={values.publishAt ?? ""}
              onChange={(publishAt) =>
                updateValues((v) => ({ ...v, publishAt: publishAt || null }))
              }
              nullOption={{ label: t("immediatelyLabel") }}
            />
            <p className="text-muted-foreground text-sm text-pretty">
              {t("publishDestinationsHint", { timezone: getTimeZoneLabel() })}
            </p>
          </Field>
          <Field id="announcement-expires-at" label={t("visibleUntil")}>
            <DateTimeInput
              id="announcement-expires-at"
              value={values.expiresAt ?? ""}
              onChange={(expiresAt) =>
                updateValues((v) => ({ ...v, expiresAt: expiresAt || null }))
              }
              nullOption={{ label: t("noEnd") }}
            />
          </Field>
        </div>
        {invalidWindow && (
          <p className="text-destructive mt-4 text-sm" role="alert">
            {t("endTimeAfterStart")}
          </p>
        )}
        <p className="text-muted-foreground mt-4 text-sm">{t("announcementPublicationHint")}</p>
      </SectionCard>

      <div className="bg-background/95 sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 backdrop-blur-sm">
        <SaveStatus state={pending ? "saving" : dirty ? "unsaved" : "saved"} />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {t("cancel")}
          </Button>
          <SubmitButton pending={pending} onClick={submit}>
            {submitLabel}
          </SubmitButton>
        </div>
      </div>
    </div>
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
