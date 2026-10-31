import {
  ACTIVITY_KINDS,
  type ActivityKind,
  isMealActivityKind,
} from "@hackos/shared/activity-kinds";
import type { Language } from "@hackos/shared/locale";
import { useEffect, useRef, useState } from "react";
import { type ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { MenuView } from "@/components/app-menu";
import { DateTimeField } from "@/components/date-time-field";
import {
  FormModalPeoplePicker,
  type FormModalPersonCandidate,
  FormModalShell,
  FormModalTranslationsDisclosure,
} from "@/components/form-modal-sections";
import { Section, ToggleRow } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import {
  type AdminScheduleItem,
  addScheduleOwner,
  fetchScheduleOwnerCandidates,
  fetchScheduleTranslateAvailability,
  removeScheduleOwner,
  SCHEDULE_AUDIENCES,
  type ScheduleAudience,
  type ScheduleInput,
  type ScheduleOwner,
  type ScheduleTranslations,
  saveScheduleTranslations,
  scheduleTypeLabel,
  translateScheduleContent,
} from "@/lib/schedule";
import { prepareScheduleSubmission, scheduleSaveError } from "@/lib/schedule-save";
import { colors, radius, type } from "@/theme";
import { isAccessibilityTextSize } from "@/theme/dynamic-type";

const LANGUAGES: Language[] = ["es", "gl", "en"];

function languageTag(language: Language, t: ReturnType<typeof useLocale>["t"]): string {
  return t(language === "es" ? "spanishTag" : language === "gl" ? "galicianTag" : "englishTag");
}

function audienceLabel(audience: ScheduleAudience, t: ReturnType<typeof useLocale>["t"]): string {
  switch (audience) {
    case "participant":
      return t("scheduleAudienceParticipant");
    case "sponsor":
      return t("scheduleAudienceSponsor");
    case "mentor":
      return t("scheduleAudienceMentor");
  }
}

function emptyForm(): ScheduleInput {
  const now = new Date();
  const startsAt = new Date(now);
  startsAt.setMinutes(0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  return {
    title: "",
    description: null,
    location: null,
    type: "activity",
    requiresScan: false,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    visibility: "hidden",
    publishAt: null,
    // New items default to reaching participants — staff-only (empty) is an
    // explicit opt-out, not the common case.
    audiences: ["participant"],
    liveActivityAudience: false,
    contactNote: null,
    notes: null,
  };
}

/**
 * H50 extension: `title`/`description` always resolve into the *viewer's*
 * own language, not the item's stored primary — editing an item authored in
 * another language shows/edits that viewer's translation (blank if none
 * exists yet), never a foreign-language value under a mismatched label.
 * Saving re-anchors primary_language to the editor's language server-side
 * (see the API's updateScheduleItem/reanchorPrimaryLanguage).
 */
/** The non-viewer locales' hand-edited/machine-translated title+description, including the item's original primary language if it isn't the viewer's own (H50 extension). */
export { scheduleItemToForm, scheduleItemToTranslations } from "@hackos/shared/schedule-form";

/**
 * Admin create/edit form (H59 3c) — same field set and validation as the
 * web app's ScheduleFormModal, not a reduced mobile form.
 */
export function ScheduleFormModal({
  visible,
  onClose,
  initial,
  initialTranslations,
  scheduleId,
  initialOwners,
  onSubmit,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  /** Present when editing; omit for create. */
  initial?: ScheduleInput;
  /**
   * Present only when editing — same reason as scheduleId below. Already
   * resolved into the *viewer's* language by scheduleItemToTranslations
   * (H50 extension): editing an item authored in another language, this
   * includes that original language as a normal translation entry.
   */
  initialTranslations?: ScheduleTranslations;
  scheduleId?: number;
  initialOwners?: ScheduleOwner[];
  onSubmit: (
    values: ScheduleInput,
    pendingOwners: ({ userId: number } | { freeTextName: string })[],
  ) => Promise<AdminScheduleItem>;
  /** Called after the item and its translations have both been persisted. */
  onSaved?: (item: AdminScheduleItem) => void | Promise<void>;
}) {
  const { t, language: accountLanguage } = useLocale();
  const [values, setValues] = useState<ScheduleInput>(initial ?? emptyForm());
  const [owners, setOwners] = useState<ScheduleOwner[]>(initialOwners ?? []);
  const [scheduledPublish, setScheduledPublish] = useState(Boolean(initial?.publishAt));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // H50 extension: staged locally so translations can be filled in before
  // the item even exists — persisted right after create/update below.
  const [translations, setTranslations] = useState<ScheduleTranslations>(initialTranslations ?? {});
  const [translateAvailable, setTranslateAvailable] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);
  // An item with no audience tag is staff-only, full stop — visibility/publishAt
  // describe when a *tagged* audience gets to see an item, so they're meaningless
  // (and the API silently forces them back to hidden/null) without one (H59 follow-up).
  const hasAudience = (values.audiences ?? []).length > 0;

  // Parents rebuild these props on every render (and the schedule now
  // refreshes in the background), so the form must only reset when it opens —
  // never wipe what the user is typing.
  const initialRef = useRef({ initial, initialOwners, initialTranslations });
  initialRef.current = { initial, initialOwners, initialTranslations };
  useEffect(() => {
    if (!visible) return;
    const start = initialRef.current;
    setValues(start.initial ?? emptyForm());
    setOwners(start.initialOwners ?? []);
    setScheduledPublish(Boolean(start.initial?.publishAt));
    setTranslations(start.initialTranslations ?? {});
    setTranslationsOpen(false);
    setError(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void fetchScheduleTranslateAvailability()
      .then((available) => {
        if (!cancelled) setTranslateAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setTranslateAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const targetLanguages = LANGUAGES.filter((language) => language !== accountLanguage);
  // Automatic translation only ever fills a blank locale — once one has
  // translated text, redoing it means clearing it by hand first (mirrors
  // announcements' "only fill languages that are still empty" rule).
  const blankTargetLanguages = targetLanguages.filter((language) => !translations[language]?.title);

  async function autoTranslate() {
    if (blankTargetLanguages.length === 0) return;
    if (!values.title.trim()) {
      showError(t("scheduleTitleRequired"));
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      const result = await translateScheduleContent({
        title: values.title,
        description: values.description,
        targetLanguages: blankTargetLanguages,
      });
      setTranslations((current) => ({ ...current, ...result }));
    } catch {
      showError(t("couldNotTranslate"));
    } finally {
      setTranslating(false);
    }
  }

  function showError(message: string) {
    setError(message);
    // The form is long: bring the message into view instead of leaving it
    // below the fold.
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function save() {
    const prepared = prepareScheduleSubmission(values, translations);
    if (!prepared) {
      showError(t("scheduleTitleRequired"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      let result = await onSubmit(
        {
          ...prepared.values,
          publishAt: scheduledPublish ? prepared.values.publishAt : null,
          // #966: only an item with an audience can show it a Live Activity.
          liveActivityAudience:
            (prepared.values.audiences ?? []).length > 0 &&
            prepared.values.liveActivityAudience === true,
        },
        owners.map((owner) =>
          owner.userId !== null
            ? { userId: owner.userId }
            : { freeTextName: owner.freeTextName as string },
        ),
      );
      if (Object.keys(prepared.translations).length > 0) {
        result = await saveScheduleTranslations(result.id, prepared.translations);
      }
      await onSaved?.(result);
    } catch (cause) {
      showError(scheduleSaveError(cause, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormModalShell
      visible={visible}
      onClose={onClose}
      onSave={() => void save()}
      pending={pending}
      scrollRef={scrollRef}
      title={scheduleId ? t("scheduleEdit") : t("scheduleAdd")}
    >
      {error ? (
        <View
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={{
            backgroundColor: colors.destructiveSurface,
            borderCurve: "continuous",
            borderRadius: radius.control,
            padding: 14,
          }}
        >
          <Text
            selectable
            style={{ color: colors.onDestructiveSurface, fontSize: type.subhead.fontSize }}
          >
            {error}
          </Text>
        </View>
      ) : null}

      <Section title={`${t("scheduleTitleLabel")} · ${languageTag(accountLanguage, t)}`}>
        <TextInput
          accessibilityLabel={t("scheduleTitleLabel")}
          onChangeText={(title) => setValues((current) => ({ ...current, title }))}
          placeholder={t("scheduleTitleLabel")}
          placeholderTextColor={colors.tertiaryLabel}
          style={{ color: colors.label, fontSize: type.callout.fontSize, padding: 16 }}
          value={values.title}
        />
      </Section>

      <Section title={`${t("scheduleDescriptionLabel")} · ${languageTag(accountLanguage, t)}`}>
        <TextInput
          accessibilityLabel={t("scheduleDescriptionLabel")}
          multiline
          onChangeText={(description) =>
            setValues((current) => ({ ...current, description: description || null }))
          }
          placeholder={t("scheduleDescriptionLabel")}
          placeholderTextColor={colors.tertiaryLabel}
          style={{
            color: colors.label,
            fontSize: type.callout.fontSize,
            lineHeight: 22,
            minHeight: 90,
            padding: 16,
            textAlignVertical: "top",
          }}
          value={values.description ?? ""}
        />
      </Section>

      <Section title={t("scheduleTypeLabel")}>
        <MenuView
          actions={ACTIVITY_KINDS.map((kind) => ({
            id: kind,
            title: scheduleTypeLabel(kind, t),
            state: values.type === kind ? ("on" as const) : ("off" as const),
          }))}
          onPressAction={({ nativeEvent }) =>
            setValues((current) => {
              const type = nativeEvent.event as ActivityKind;
              return {
                ...current,
                type,
                requiresScan: isMealActivityKind(type) || current.requiresScan,
              };
            })
          }
        >
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              minHeight: 50,
              padding: 16,
            }}
          >
            <Text style={{ color: colors.label, flex: 1, fontSize: type.callout.fontSize }}>
              {scheduleTypeLabel(values.type, t)}
            </Text>
            <SymbolView
              name="chevron.up.chevron.down"
              tintColor={colors.secondaryLabel}
              size={14}
            />
          </View>
        </MenuView>
      </Section>

      <FormModalTranslationsDisclosure
        expanded={translationsOpen}
        onToggle={() => setTranslationsOpen((open) => !open)}
        onTranslate={() => void autoTranslate()}
        translateAccessibilityState={{
          busy: translating,
          disabled: blankTargetLanguages.length === 0,
        }}
        translateAvailable={translateAvailable}
        translateButtonStyle={{ paddingHorizontal: 16, paddingVertical: 10 }}
        translateDisabled={translating || blankTargetLanguages.length === 0}
        translating={translating}
      >
        {targetLanguages.map((language) => (
          <View key={language} style={{ gap: 8 }}>
            <Section title={`${t("scheduleTitleLabel")} · ${languageTag(language, t)}`}>
              <TextInput
                accessibilityLabel={t("scheduleTitleLabel")}
                onChangeText={(title) =>
                  setTranslations((current) => ({
                    ...current,
                    [language]: { ...current[language], title },
                  }))
                }
                placeholderTextColor={colors.tertiaryLabel}
                style={{
                  color: colors.label,
                  fontSize: type.callout.fontSize,
                  padding: 16,
                }}
                value={translations[language]?.title ?? ""}
              />
            </Section>
            <Section title={`${t("scheduleDescriptionLabel")} · ${languageTag(language, t)}`}>
              <TextInput
                accessibilityLabel={t("scheduleDescriptionLabel")}
                multiline
                onChangeText={(description) =>
                  setTranslations((current) => ({
                    ...current,
                    [language]: { ...current[language], description },
                  }))
                }
                placeholderTextColor={colors.tertiaryLabel}
                style={{
                  color: colors.label,
                  fontSize: type.callout.fontSize,
                  lineHeight: 22,
                  minHeight: 70,
                  padding: 16,
                  textAlignVertical: "top",
                }}
                value={translations[language]?.description ?? ""}
              />
            </Section>
          </View>
        ))}
      </FormModalTranslationsDisclosure>

      <Section title={t("scheduleLocationLabel")}>
        <TextInput
          accessibilityLabel={t("scheduleLocationLabel")}
          onChangeText={(location) =>
            setValues((current) => ({ ...current, location: location || null }))
          }
          placeholder={t("scheduleLocationLabel")}
          placeholderTextColor={colors.tertiaryLabel}
          style={{ color: colors.label, fontSize: type.callout.fontSize, padding: 16 }}
          value={values.location ?? ""}
        />
      </Section>

      <View style={{ gap: 8 }}>
        <Text
          accessibilityRole="header"
          style={{
            color: colors.secondaryLabel,
            fontSize: type.footnote.fontSize,
            fontWeight: "600",
            paddingHorizontal: 16,
          }}
        >
          {t("scheduleStartsAtLabel")}
        </Text>
        <DateTimeField
          dateAccessibilityLabel={t("scheduleStartsAtLabel")}
          timeAccessibilityLabel={t("scheduleStartsAtLabel")}
          value={new Date(values.startsAt)}
          onChange={(date) =>
            setValues((current) => ({ ...current, startsAt: date.toISOString() }))
          }
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text
          accessibilityRole="header"
          style={{
            color: colors.secondaryLabel,
            fontSize: type.footnote.fontSize,
            fontWeight: "600",
            paddingHorizontal: 16,
          }}
        >
          {t("scheduleEndsAtLabel")}
        </Text>
        <DateTimeField
          dateAccessibilityLabel={t("scheduleEndsAtLabel")}
          timeAccessibilityLabel={t("scheduleEndsAtLabel")}
          value={new Date(values.endsAt)}
          onChange={(date) => setValues((current) => ({ ...current, endsAt: date.toISOString() }))}
        />
      </View>

      <View style={{ gap: 6 }}>
        <Section title={t("scheduleFilterAudience")}>
          {SCHEDULE_AUDIENCES.map((audience, index) => {
            const selected = (values.audiences ?? []).includes(audience);
            return (
              <View key={audience}>
                {index > 0 ? (
                  <View
                    style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }}
                  />
                ) : null}
                <ToggleRow
                  label={audienceLabel(audience, t)}
                  value={selected}
                  disabled={isMealActivityKind(values.type) && audience === "participant"}
                  onChange={(next) => {
                    const audiences = next
                      ? [...(values.audiences ?? []), audience]
                      : (values.audiences ?? []).filter((a) => a !== audience);
                    setValues((current) => ({
                      ...current,
                      audiences,
                      requiresScan: audiences.includes("participant")
                        ? current.requiresScan
                        : false,
                      // Mirror the API's own normalization immediately so the
                      // form never shows a "Shown"/scheduled-publish state
                      // that's about to become a no-op (H59 follow-up).
                      ...(audiences.length === 0
                        ? { visibility: "hidden" as const, publishAt: null }
                        : {}),
                    }));
                    if (audiences.length === 0) setScheduledPublish(false);
                  }}
                />
              </View>
            );
          })}
        </Section>

        <Text
          style={{
            color: colors.secondaryLabel,
            fontSize: type.footnote.fontSize,
            paddingHorizontal: 16,
          }}
        >
          {t("scheduleStaffSeeAllHint")}
        </Text>
      </View>

      {hasAudience ? (
        <Section>
          <ToggleRow
            label={t("scheduleVisibilityLabel")}
            value={values.visibility === "shown"}
            onChange={(shown) =>
              setValues((current) => ({
                ...current,
                visibility: shown ? "shown" : "hidden",
              }))
            }
          />
          {values.visibility === "shown" ? null : (
            <>
              <View style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }} />
              <ToggleRow
                label={t("schedulePublishAtLabel")}
                value={scheduledPublish}
                onChange={setScheduledPublish}
              />
              {scheduledPublish ? (
                <View style={{ padding: 16, paddingTop: 0 }}>
                  <DateTimeField
                    dateAccessibilityLabel={t("schedulePublishAtLabel")}
                    timeAccessibilityLabel={t("schedulePublishAtLabel")}
                    value={values.publishAt ? new Date(values.publishAt) : new Date()}
                    onChange={(date) =>
                      setValues((current) => ({ ...current, publishAt: date.toISOString() }))
                    }
                  />
                </View>
              ) : null}
            </>
          )}
        </Section>
      ) : null}

      {hasAudience && (values.audiences ?? []).includes("participant") ? (
        <Section>
          <ToggleRow
            label={t("scheduleRequiresScanLabel")}
            value={values.requiresScan}
            onChange={(requiresScan) => setValues((current) => ({ ...current, requiresScan }))}
          />
        </Section>
      ) : null}

      {hasAudience ? (
        <Section>
          <ToggleRow
            label={t("scheduleLiveActivityLabel")}
            value={values.liveActivityAudience === true}
            onChange={(liveActivityAudience) =>
              setValues((current) => ({ ...current, liveActivityAudience }))
            }
          />
        </Section>
      ) : null}

      <Section title={t("scheduleContactNoteLabel")}>
        <TextInput
          accessibilityLabel={t("scheduleContactNoteLabel")}
          onChangeText={(contactNote) =>
            setValues((current) => ({ ...current, contactNote: contactNote || null }))
          }
          placeholder={t("scheduleContactNoteLabel")}
          placeholderTextColor={colors.tertiaryLabel}
          style={{ color: colors.label, fontSize: type.callout.fontSize, padding: 16 }}
          value={values.contactNote ?? ""}
        />
      </Section>

      <Section title={t("scheduleNotesLabel")}>
        <TextInput
          accessibilityLabel={t("scheduleNotesLabel")}
          multiline
          onChangeText={(notes) => setValues((current) => ({ ...current, notes: notes || null }))}
          placeholder={t("scheduleNotesLabel")}
          placeholderTextColor={colors.tertiaryLabel}
          style={{
            color: colors.label,
            fontSize: type.callout.fontSize,
            lineHeight: 22,
            minHeight: 70,
            padding: 16,
            textAlignVertical: "top",
          }}
          value={values.notes ?? ""}
        />
      </Section>

      <OwnersField owners={owners} onChange={setOwners} scheduleId={scheduleId} />
    </FormModalShell>
  );
}

/**
 * Responsible-person picker. In create mode there's no `scheduleId` yet, so
 * additions/removals just mutate local state; the caller assigns
 * `pendingOwnerIds` after the item is created. In edit mode, each tap hits
 * the owner endpoints immediately (mirrors the web admin table's picker).
 */
/** A candidate returned by the owner-candidates search. */
type OwnerCandidate = FormModalPersonCandidate;

/** Negative, decrementing — real owner ids from the API are always positive. */
let nextLocalOwnerId = -1;

function OwnersField({
  owners,
  onChange,
  scheduleId,
}: {
  owners: ScheduleOwner[];
  onChange: (owners: ScheduleOwner[]) => void;
  scheduleId?: number;
}) {
  const accessibilityText = isAccessibilityTextSize(useWindowDimensions().fontScale);
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [freeTextName, setFreeTextName] = useState("");
  const [results, setResults] = useState<OwnerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<Error | null>(null);
  const [mutation, setMutation] = useState<string | null>(null);
  const requestId = useRef(0);

  const ownerIds = new Set(owners.flatMap((owner) => (owner.userId ? [owner.userId] : [])));

  async function search() {
    const trimmed = query.trim();
    // Matches the API's own minimum (schemas.ts scheduleOwnerCandidatesQuery)
    // — searching below it would just 400.
    if (trimmed.length < 2) return;
    const currentRequest = ++requestId.current;
    setSearching(true);
    setSearchError(null);
    try {
      const users = await fetchScheduleOwnerCandidates(trimmed);
      if (currentRequest === requestId.current) {
        setResults(users);
        setSearched(true);
      }
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setResults([]);
        setSearchError(cause instanceof Error ? cause : new Error("Search failed"));
      }
    } finally {
      if (currentRequest === requestId.current) setSearching(false);
    }
  }

  async function add(candidate: OwnerCandidate) {
    if (ownerIds.has(candidate.id)) return;
    setMutation(`add-user:${candidate.id}`);
    setSearchError(null);
    try {
      if (scheduleId) {
        const created = await addScheduleOwner(scheduleId, { userId: candidate.id });
        onChange([...owners, created]);
      } else {
        onChange([
          ...owners,
          {
            id: nextLocalOwnerId--,
            userId: candidate.id,
            name: candidate.name,
            surname: candidate.surname,
            email: candidate.email,
            freeTextName: null,
          },
        ]);
      }
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause : new Error("Add failed"));
    } finally {
      setMutation(null);
    }
  }

  async function addFreeText() {
    const name = freeTextName.trim();
    if (!name) return;
    setMutation("add-text");
    setSearchError(null);
    try {
      if (scheduleId) {
        const created = await addScheduleOwner(scheduleId, { freeTextName: name });
        onChange([...owners, created]);
      } else {
        onChange([
          ...owners,
          {
            id: nextLocalOwnerId--,
            userId: null,
            name: null,
            surname: null,
            freeTextName: name,
          },
        ]);
      }
      setFreeTextName("");
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause : new Error("Add failed"));
    } finally {
      setMutation(null);
    }
  }

  async function remove(ownerId: number) {
    setMutation(`remove:${ownerId}`);
    setSearchError(null);
    try {
      if (scheduleId && ownerId > 0) await removeScheduleOwner(scheduleId, ownerId);
      onChange(owners.filter((owner) => owner.id !== ownerId));
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause : new Error("Remove failed"));
    } finally {
      setMutation(null);
    }
  }

  return (
    <FormModalPeoplePicker
      title={t("scheduleOwnersLabel")}
      accessibilityLabel={t("scheduleOwnerSearchPlaceholder")}
      query={query}
      onChangeQuery={(value) => {
        setQuery(value);
        setResults([]);
        setSearched(false);
      }}
      onClear={() => {
        setQuery("");
        setResults([]);
        setSearched(false);
      }}
      onSearch={() => void search()}
      editable={mutation === null && !searching}
      searching={searching}
      searched={searched}
      searchError={searchError}
      candidates={results}
      emptyResultsLabel={t("scheduleOwnerSearchEmpty")}
      renderCandidateAction={(candidate) =>
        mutation === `add-user:${candidate.id}` ? (
          <AppActivityIndicator size="small" color={colors.accent} />
        ) : (
          <PressableFeedback
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={t("scheduleOwnerAdd")}
            disabled={mutation !== null}
            onPress={() => void add(candidate)}
            hitSlop={8}
            style={{
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              minWidth: 44,
            }}
          >
            <Text style={{ color: colors.accent, fontSize: type.callout.fontSize }}>
              {t("add")}
            </Text>
          </PressableFeedback>
        )
      }
    >
      <View
        style={{
          alignItems: "center",
          borderTopColor: colors.separator,
          borderTopWidth: 0.5,
          flexDirection: "row",
          gap: 8,
          padding: 16,
        }}
      >
        <TextInput
          accessibilityLabel={t("ownerFreeTextPlaceholder")}
          editable={mutation === null}
          onChangeText={setFreeTextName}
          onSubmitEditing={() => void addFreeText()}
          placeholder={t("ownerFreeTextPlaceholder")}
          placeholderTextColor={colors.tertiaryLabel}
          returnKeyType="done"
          value={freeTextName}
          hitSlop={{ top: 4, bottom: 4 }}
          style={{
            backgroundColor: colors.elevatedSurface,
            borderCurve: "continuous",
            borderRadius: radius.chip,
            color: colors.label,
            flex: 1,
            fontSize: type.callout.fontSize,
            minHeight: 36,
            paddingHorizontal: 8,
          }}
        />
        {mutation === "add-text" ? (
          <AppActivityIndicator size="small" color={colors.accent} />
        ) : (
          <PressableFeedback
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={t("scheduleOwnerAdd")}
            disabled={mutation !== null || !freeTextName.trim()}
            onPress={() => void addFreeText()}
            hitSlop={{ top: 12, bottom: 12, left: 7, right: 7 }}
          >
            <Text style={{ color: colors.accent, fontSize: type.callout.fontSize }}>
              {t("add")}
            </Text>
          </PressableFeedback>
        )}
      </View>
      {owners.length === 0 ? (
        <View style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}>
          <Text style={{ color: colors.tertiaryLabel, fontSize: type.compact.fontSize }}>
            {t("scheduleOwnersEmpty")}
          </Text>
        </View>
      ) : (
        owners.map((owner) => (
          <View key={owner.id}>
            <View style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }} />
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 12,
                minHeight: 44,
                paddingHorizontal: 16,
                paddingVertical: 6,
              }}
            >
              <Text
                selectable
                numberOfLines={accessibilityText ? undefined : 1}
                style={{ color: colors.label, flex: 1, fontSize: type.callout.fontSize }}
              >
                {owner.freeTextName ??
                  ([owner.name, owner.surname].filter(Boolean).join(" ").trim() ||
                    owner.email ||
                    "")}
              </Text>
              {mutation === `remove:${owner.id}` ? (
                <AppActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <PressableFeedback
                  feedback="opacity"
                  accessibilityLabel={t("scheduleDelete")}
                  accessibilityRole="button"
                  disabled={mutation !== null}
                  onPress={() => void remove(owner.id)}
                  hitSlop={8}
                  style={{
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 44,
                    minWidth: 44,
                  }}
                >
                  <Text style={{ color: colors.destructive, fontSize: type.callout.fontSize }}>
                    {t("remove")}
                  </Text>
                </PressableFeedback>
              )}
            </View>
          </View>
        ))
      )}
    </FormModalPeoplePicker>
  );
}
