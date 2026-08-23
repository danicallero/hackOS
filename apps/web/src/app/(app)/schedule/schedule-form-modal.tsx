"use client";

// Shared schedule item create/edit modal (H48/H59) — used by the Manage
// Schedule table (/schedule; click an item's title/description cell to open
// it here for a full edit, including moving an item to a different day via
// its full Starts date).

import { ACTIVITY_KINDS, isMealActivityKind } from "@hackos/shared/activity-kinds";
import { CalendarDaysIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { getTimeZoneLabel, toDatetimeLocal } from "@/lib/datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import {
  logisticsApi,
  type PublicScheduleItem,
  type ScheduleInput,
  type ScheduleOwner,
  type ScheduleTranslations,
} from "@/lib/logistics";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SCHEDULE_AUDIENCES, scheduleAudienceLabel, scheduleTypeLabel } from "./schedule-model";

const LANGUAGES = ["es", "gl", "en"] as const;

function languageTag(language: Language, t: Translate): string {
  return t(language === "es" ? "spanishTag" : language === "gl" ? "galicianTag" : "englishTag");
}

export const EMPTY_SCHEDULE_FORM: ScheduleInput = {
  title: "",
  description: "",
  location: "",
  type: "activity",
  requiresScan: false,
  startsAt: "",
  endsAt: "",
  visibility: "hidden",
  publishAt: null,
  // Unchecked/empty is a valid state and means staff-only (H59) — no default audience.
  audiences: [],
  contactNote: "",
  notes: "",
};

/**
 * H50 extension: `title`/`description` always resolve into the *viewer's*
 * own language, not the item's stored primary — editing an item authored in
 * another language shows/edits that viewer's translation (blank if none
 * exists yet), never a foreign-language value under a mismatched label.
 * Saving re-anchors primary_language to the editor's language server-side
 * (see updateScheduleItem's reanchorPrimaryLanguage).
 */
export function scheduleItemToForm(
  item: PublicScheduleItem,
  accountLanguage: Language,
): ScheduleInput {
  const resolved =
    item.primaryLanguage === accountLanguage
      ? { title: item.title, description: item.description }
      : {
          title: item.titleI18n?.[accountLanguage] ?? "",
          description: item.descriptionI18n?.[accountLanguage] ?? "",
        };
  return {
    title: resolved.title,
    description: resolved.description ?? "",
    location: item.location ?? "",
    type: item.type ?? "activity",
    requiresScan: item.requiresScan ?? false,
    startsAt: toDatetimeLocal(item.startsAt),
    endsAt: toDatetimeLocal(item.endsAt),
    visibility: item.visibility ?? "hidden",
    publishAt: toDatetimeLocal(item.publishAt),
    audiences: item.audiences ?? [],
    contactNote: item.contactNote ?? "",
    notes: item.notes ?? "",
  };
}

/** The non-viewer locales' hand-edited/machine-translated title+description, including the item's original primary language if it isn't the viewer's own (H50 extension). */
export function scheduleItemToTranslations(
  item: PublicScheduleItem,
  accountLanguage: Language,
): ScheduleTranslations {
  const translations: ScheduleTranslations = {};
  for (const language of LANGUAGES) {
    if (language === accountLanguage) continue;
    if (language === item.primaryLanguage) {
      translations[language] = { title: item.title, description: item.description };
      continue;
    }
    const title = item.titleI18n?.[language];
    const description = item.descriptionI18n?.[language];
    if (title !== undefined || description !== undefined) {
      translations[language] = { title, description };
    }
  }
  return translations;
}

export function scheduleDuplicateForm(
  item: PublicScheduleItem,
  accountLanguage: Language,
): ScheduleInput {
  const form = scheduleItemToForm(item, accountLanguage);
  return {
    ...form,
    title: form.title ? `${form.title} (copy)` : form.title,
    // A duplicated item should not unexpectedly appear on the public agenda.
    visibility: "hidden",
    publishAt: null,
  };
}

export function cleanScheduleForm(form: ScheduleInput): ScheduleInput {
  return {
    title: form.title.trim(),
    description: form.description?.trim() || null,
    location: form.location?.trim() || null,
    type: form.type?.trim() || null,
    requiresScan: isMealActivityKind(form.type) || form.requiresScan === true,
    startsAt: new Date(form.startsAt).toISOString(),
    endsAt: new Date(form.endsAt).toISOString(),
    visibility: form.visibility,
    publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : null,
    audiences: form.audiences ?? [],
    contactNote: form.contactNote?.trim() || null,
    notes: form.notes?.trim() || null,
  };
}

export function ScheduleFormModal({
  open,
  onOpenChange,
  title,
  initial,
  initialTranslations,
  onSubmit,
  scheduleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial: ScheduleInput;
  /**
   * Present only when editing an existing item — same reason as scheduleId
   * below. Already resolved into the *viewer's* language by
   * scheduleItemToTranslations (H50 extension): editing an item authored in
   * another language, this includes that original language as a normal
   * translation entry.
   */
  initialTranslations?: ScheduleTranslations;
  /**
   * `pendingOwners` is only populated in create mode (no `scheduleId` yet)
   * — the caller is responsible for assigning them to the newly created item
   * (H59: the responsible-person picker needs to work before the row exists).
   * The resolved id lets the modal persist any staged translations right
   * after creation.
   */
  onSubmit: (values: ScheduleInput, pendingOwners: PendingOwner[]) => Promise<{ id: number }>;
  /** Present only when editing an existing item — owner assignment needs a real id. */
  scheduleId?: number;
}) {
  const { t, language: accountLanguage } = useLocale();
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scheduledPublish, setScheduledPublish] = useState(Boolean(initial.publishAt));
  const [pendingOwners, setPendingOwners] = useState<PendingOwner[]>([]);
  // H50 extension: staged locally so translations can be filled in before
  // the item even exists — persisted right after create/update below.
  const [translations, setTranslations] = useState<ScheduleTranslations>(initialTranslations ?? {});
  const [translateAvailable, setTranslateAvailable] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);

  useEffect(() => {
    setValues(initial);
    setAdvancedOpen(false);
    setTranslationsOpen(false);
    setScheduledPublish(Boolean(initial.publishAt));
    setPendingOwners([]);
    setTranslations(initialTranslations ?? {});
  }, [initial, initialTranslations]);

  useEffect(() => {
    let cancelled = false;
    logisticsApi
      .scheduleTranslateAvailability()
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

  const targetLanguages = LANGUAGES.filter((language) => language !== accountLanguage);
  // Automatic translation only ever fills a blank locale — once one has
  // translated text, redoing it means clearing it by hand first (mirrors
  // announcements' "only fill languages that are still empty" rule).
  const blankTargetLanguages = targetLanguages.filter((language) => !translations[language]?.title);

  async function autoTranslate() {
    if (blankTargetLanguages.length === 0) return;
    setTranslating(true);
    try {
      const result = await logisticsApi.translateScheduleContent({
        title: values.title,
        description: values.description,
        targetLanguages: blankTargetLanguages,
      });
      setTranslations((prev) => ({ ...prev, ...result }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotTranslate"));
    } finally {
      setTranslating(false);
    }
  }

  function setTranslationField(language: Language, field: "title" | "description", value: string) {
    setTranslations((prev) => ({
      ...prev,
      [language]: { ...prev[language as keyof ScheduleTranslations], [field]: value },
    }));
  }

  async function submit() {
    setPending(true);
    try {
      const result = await onSubmit(values, pendingOwners);
      if (Object.keys(translations).length > 0) {
        await logisticsApi.saveScheduleTranslations(result.id, translations);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
    } finally {
      setPending(false);
    }
  }

  const isParticipant = (values.audiences ?? []).includes("participant");
  const isMeal = isMealActivityKind(values.type);
  // An item with no audience tag is staff-only, full stop — visibility/publishAt
  // describe when a *tagged* audience gets to see an item, so they're meaningless
  // (and the API silently forces them back to hidden/null) without one (H59 follow-up).
  const hasAudience = (values.audiences ?? []).length > 0;

  function toggleAudience(audience: (typeof SCHEDULE_AUDIENCES)[number], checked: boolean) {
    setValues((v) => {
      const current = new Set(v.audiences ?? []);
      if (checked) current.add(audience);
      else current.delete(audience);
      // Only a participant-visible item can be scanner-registrable (H59).
      const requiresScan = audience === "participant" && !checked ? false : v.requiresScan;
      const next = { ...v, audiences: Array.from(current), requiresScan };
      // Mirror the API's own normalization immediately so the form never shows
      // a "Shown"/scheduled-publish state that's about to become a no-op.
      if (next.audiences.length === 0) {
        next.visibility = "hidden";
        next.publishAt = null;
        setScheduledPublish(false);
      }
      return next;
    });
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} icon={CalendarDaysIcon} size="xl">
      <div className="space-y-5">
        <Field
          id="schedule-title"
          label={`${t("titleLabel")} · ${languageTag(accountLanguage, t)}`}
        >
          <Input
            id="schedule-title"
            value={values.title}
            onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
            placeholder={t("openingCeremonyPlaceholder")}
          />
        </Field>

        <Field
          id="schedule-description"
          label={`${t("descriptionLabel")} · ${languageTag(accountLanguage, t)}`}
        >
          <Textarea
            id="schedule-description"
            value={values.description ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            placeholder={t("visibleInPublicAgenda")}
          />
        </Field>

        <Field id="schedule-type" label={t("colType")}>
          <Select
            value={values.type ?? "activity"}
            onValueChange={(type) =>
              setValues((v) => ({
                ...v,
                type,
                requiresScan: isMealActivityKind(type) || v.requiresScan,
              }))
            }
          >
            <SelectTrigger id="schedule-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_KINDS.map((type) => (
                <SelectItem key={type} value={type}>
                  {scheduleTypeLabel(type, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id="schedule-audiences" label={t("audienceLabel")}>
          <p className="text-muted-foreground -mt-1 text-xs">{t("staffSeeAllHint")}</p>
          <div className="flex flex-wrap gap-4">
            {SCHEDULE_AUDIENCES.map((audience) => (
              <div key={audience} className="flex items-center gap-2">
                <Checkbox
                  id={`schedule-audience-${audience}`}
                  checked={(values.audiences ?? []).includes(audience)}
                  onCheckedChange={(checked) => toggleAudience(audience, checked === true)}
                />
                <Label htmlFor={`schedule-audience-${audience}`} className="font-normal">
                  {scheduleAudienceLabel(audience, t)}
                </Label>
              </div>
            ))}
          </div>
        </Field>

        {isParticipant && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="requires-scan"
              checked={isMeal || values.requiresScan === true}
              disabled={isMeal}
              onCheckedChange={(checked) =>
                setValues((v) => ({ ...v, requiresScan: checked === true }))
              }
            />
            <Label htmlFor="requires-scan" className="font-normal">
              {t("registrableByScanner")}
              {isMeal ? t("mealsAlwaysRegistrable") : ""}
            </Label>
          </div>
        )}

        {hasAudience && (
          <Field id="schedule-visibility" label={t("colVisibility")}>
            <Select
              value={values.visibility}
              onValueChange={(visibility) =>
                setValues((v) => ({ ...v, visibility: visibility as "shown" | "hidden" }))
              }
            >
              <SelectTrigger id="schedule-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hidden">{t("hiddenOption")}</SelectItem>
                <SelectItem value="shown">{t("shownOption")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        {/*
          Each field now renders a native date input plus a native time
          input (see DateTimeInput) — three columns need more room than the
          `sm` breakpoint (640px) guarantees inside this modal, or the two
          controls collapse into unreadable clipped boxes without actually
          overflowing the modal (H59 follow-up, #490). `lg` lines up with
          where the xl modal is reliably at its full 896px cap.
        */}
        <div className="grid gap-3 lg:grid-cols-3">
          <Field id="schedule-starts" label={t("colStarts")} className="min-w-0">
            <DateTimeInput
              id="schedule-starts"
              value={values.startsAt}
              onChange={(startsAt) => setValues((v) => ({ ...v, startsAt }))}
            />
          </Field>
          <Field id="schedule-ends" label={t("endsLabel")} className="min-w-0">
            <DateTimeInput
              id="schedule-ends"
              value={values.endsAt}
              onChange={(endsAt) => setValues((v) => ({ ...v, endsAt }))}
            />
          </Field>
          <Field id="schedule-location" label={t("locationLabel")} className="min-w-0">
            <Input
              id="schedule-location"
              value={values.location ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, location: e.target.value }))}
              placeholder={t("mainHallPlaceholder")}
            />
          </Field>
        </div>

        <Collapsible open={translationsOpen} onOpenChange={setTranslationsOpen}>
          <div className="flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3">
            <CollapsibleTrigger asChild>
              <button type="button" className="flex items-center gap-2 text-sm font-medium">
                <ChevronDownIcon
                  className={cn("size-4 transition-transform", translationsOpen && "rotate-180")}
                />
                {t("translationsAndSettings")}
              </button>
            </CollapsibleTrigger>
            {translateAvailable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={translating || blankTargetLanguages.length === 0}
                onClick={() => void autoTranslate()}
              >
                {translating ? t("translatingInProgress") : t("translateAutomatically")}
              </Button>
            ) : null}
          </div>
          <CollapsibleContent className="rounded-b-lg border border-t-0 px-4 pt-3 pb-4">
            <div className="grid gap-4 md:grid-cols-2">
              {targetLanguages.map((language) => (
                <div key={language} className="grid gap-3">
                  <Field
                    id={`schedule-title-${language}`}
                    label={`${t("titleLabel")} · ${languageTag(language, t)}`}
                  >
                    <Input
                      id={`schedule-title-${language}`}
                      value={translations[language]?.title ?? ""}
                      onChange={(e) => setTranslationField(language, "title", e.target.value)}
                    />
                  </Field>
                  <Field
                    id={`schedule-description-${language}`}
                    label={`${t("descriptionLabel")} · ${languageTag(language, t)}`}
                  >
                    <Textarea
                      id={`schedule-description-${language}`}
                      rows={3}
                      value={translations[language]?.description ?? ""}
                      onChange={(e) => setTranslationField(language, "description", e.target.value)}
                    />
                  </Field>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ml-2">
              <ChevronDownIcon
                className={cn("size-4 transition-transform", advancedOpen && "rotate-180")}
              />
              {t("moreOptions")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-5 pt-3">
            {hasAudience && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="schedule-publication-toggle"
                    checked={scheduledPublish}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setScheduledPublish(next);
                      setValues((v) => ({
                        ...v,
                        publishAt: next ? toDatetimeLocal(new Date().toISOString()) : null,
                      }));
                    }}
                  />
                  <Label htmlFor="schedule-publication-toggle" className="font-normal">
                    {t("schedulePublicationLabel")}
                  </Label>
                </div>
                {scheduledPublish && (
                  <Field id="schedule-publish-at" label={t("publishAtLabel")}>
                    <DateTimeInput
                      id="schedule-publish-at"
                      value={values.publishAt ?? ""}
                      onChange={(publishAt) =>
                        setValues((v) => ({ ...v, publishAt: publishAt || null }))
                      }
                    />
                    <p className="text-muted-foreground text-sm text-pretty">
                      {t("publishDestinationsHint", { timezone: getTimeZoneLabel() })}
                    </p>
                  </Field>
                )}
              </div>
            )}
            <Field id="schedule-notes" label={t("internalNotesLabel")}>
              <Textarea
                id="schedule-notes"
                value={values.notes ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
                placeholder={t("notesPlaceholder")}
              />
            </Field>
            <Field id="schedule-contact-note" label={t("contactNoteLabel")}>
              <Input
                id="schedule-contact-note"
                value={values.contactNote ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, contactNote: e.target.value }))}
                placeholder={t("contactNotePlaceholder")}
              />
            </Field>
            {scheduleId ? (
              <OwnersField scheduleId={scheduleId} />
            ) : (
              <PendingOwnersField owners={pendingOwners} onChange={setPendingOwners} />
            )}
          </CollapsibleContent>
        </Collapsible>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <SubmitButton
            pending={pending}
            onClick={submit}
            disabled={!values.title || !values.startsAt || !values.endsAt}
          >
            {t("save")}
          </SubmitButton>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * A pending owner assignment before the item exists (H59) — either a real
 * hackOS account picked via UserPicker, or a free-text name with no login
 * (an external vendor, a volunteer). Mirrors the addScheduleOwner union.
 */
export type PendingOwner = { kind: "user"; user: UserOption } | { kind: "freeText"; name: string };

function pendingOwnerLabel(owner: PendingOwner): string {
  if (owner.kind === "freeText") return owner.name;
  return [owner.user.name, owner.user.surname].filter(Boolean).join(" ").trim() || owner.user.email;
}

function pendingOwnerKey(owner: PendingOwner): string {
  return owner.kind === "user" ? `user:${owner.user.id}` : `text:${owner.name}`;
}

/** Converts a pending owner into the shape addScheduleOwner's body expects. */
export function pendingOwnerToInput(
  owner: PendingOwner,
): { userId: number } | { freeTextName: string } {
  return owner.kind === "user" ? { userId: owner.user.id } : { freeTextName: owner.name };
}

/**
 * Responsible-person picker for a new (not-yet-created) item (H59) — a
 * schedule_owners row needs a real schedule_id, so selections just live in
 * local state here until the caller creates the item and assigns them.
 */
function PendingOwnersField({
  owners,
  onChange,
}: {
  owners: PendingOwner[];
  onChange: (next: PendingOwner[]) => void;
}) {
  const { t } = useLocale();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [freeTextName, setFreeTextName] = useState("");

  const ownerIds = new Set(
    owners.filter((o) => o.kind === "user").map((o) => (o as { user: UserOption }).user.id),
  );
  async function searchAvailableUsers(query: string): Promise<UserOption[]> {
    try {
      const r = await logisticsApi.scheduleOwnerCandidates(query);
      return r.users.filter((u) => !ownerIds.has(u.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) toast.error(t("needScheduleManageSearch"));
      else toast.error(t("searchFailed"));
      return [];
    }
  }

  function addFreeText() {
    const name = freeTextName.trim();
    if (!name) return;
    onChange([...owners, { kind: "freeText", name }]);
    setFreeTextName("");
  }

  return (
    <SectionCard title={t("ownersLabel")}>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <UserPicker
            value={selectedUserId}
            onChange={(value, user) => {
              setSelectedUserId(value);
              if (user && !ownerIds.has(user.id)) {
                onChange([...owners, { kind: "user", user }]);
                setSelectedUserId("");
              }
            }}
            search={searchAvailableUsers}
            minQueryLength={2}
            inDialog
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={freeTextName}
            onChange={(e) => setFreeTextName(e.target.value)}
            placeholder={t("ownerFreeTextPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFreeText();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!freeTextName.trim()}
            onClick={addFreeText}
          >
            {t("addAction")}
          </Button>
        </div>
        {owners.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noOwnersYet")}</p>
        ) : (
          <ul className="divide-border divide-y">
            {owners.map((owner) => (
              <li
                key={pendingOwnerKey(owner)}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="text-sm">{pendingOwnerLabel(owner)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("remove")}
                  onClick={() =>
                    onChange(owners.filter((o) => pendingOwnerKey(o) !== pendingOwnerKey(owner)))
                  }
                >
                  <XIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

/** Responsible-person assignment (H59), mirroring enterprise MembersCard. */
function OwnersField({ scheduleId }: { scheduleId: number }) {
  const { t } = useLocale();
  const [owners, setOwners] = useState<ScheduleOwner[] | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [freeTextName, setFreeTextName] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOwners = useCallback(async () => {
    try {
      const r = await logisticsApi.scheduleOwners(scheduleId);
      setOwners(r.owners);
    } catch {
      setOwners([]);
    }
  }, [scheduleId]);

  useEffect(() => {
    void loadOwners();
  }, [loadOwners]);

  const ownerUserIds = new Set((owners ?? []).flatMap((o) => (o.userId ? [o.userId] : [])));
  async function searchAvailableUsers(query: string): Promise<UserOption[]> {
    try {
      const r = await logisticsApi.scheduleOwnerCandidates(query);
      return r.users.filter((u) => !ownerUserIds.has(u.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) toast.error(t("needScheduleManageSearch"));
      else toast.error(t("searchFailed"));
      return [];
    }
  }

  async function add(input: { userId: number } | { freeTextName: string }) {
    setBusy(true);
    try {
      await logisticsApi.addScheduleOwner(scheduleId, input);
      setSelectedUserId("");
      setFreeTextName("");
      await loadOwners();
      toast.success(t("userAffiliated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddUser"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(ownerId: number) {
    setBusy(true);
    try {
      await logisticsApi.removeScheduleOwner(scheduleId, ownerId);
      await loadOwners();
      toast.success(t("affiliationRemoved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveUser"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={t("ownersLabel")}>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <UserPicker
            id={`schedule-owner-${scheduleId}`}
            value={selectedUserId}
            onChange={setSelectedUserId}
            search={searchAvailableUsers}
            minQueryLength={2}
            inDialog
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !selectedUserId}
            onClick={() => add({ userId: Number(selectedUserId) })}
          >
            {t("addAction")}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={freeTextName}
            onChange={(e) => setFreeTextName(e.target.value)}
            placeholder={t("ownerFreeTextPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (freeTextName.trim()) add({ freeTextName: freeTextName.trim() });
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !freeTextName.trim()}
            onClick={() => add({ freeTextName: freeTextName.trim() })}
          >
            {t("addAction")}
          </Button>
        </div>
        {owners === null ? (
          <Spinner className="size-5" />
        ) : owners.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noOwnersYet")}</p>
        ) : (
          <ul className="divide-border divide-y">
            {owners.map((owner) => (
              <li key={owner.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-sm">
                  {owner.freeTextName ??
                    ([owner.name, owner.surname].filter(Boolean).join(" ").trim() || owner.email)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("remove")}
                  disabled={busy}
                  onClick={() => remove(owner.id)}
                >
                  <XIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
