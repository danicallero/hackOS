import { MenuView } from "@expo/ui/community/menu";
import {
  ACTIVITY_KINDS,
  type ActivityKind,
  isMealActivityKind,
} from "@hackos/shared/activity-kinds";
import type { Language } from "@hackos/shared/locale";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DateTimeField } from "@/components/date-time-field";
import { FloatingGlassButton, Section } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
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
import { colors } from "@/theme/colors";

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
export function scheduleItemToForm(
  item: AdminScheduleItem,
  accountLanguage: Language,
): ScheduleInput {
  const resolved =
    item.primaryLanguage === accountLanguage
      ? { title: item.title, description: item.description }
      : {
          title: item.titleI18n[accountLanguage] ?? "",
          description: item.descriptionI18n[accountLanguage] ?? null,
        };
  return {
    title: resolved.title,
    description: resolved.description,
    location: item.location,
    type: item.type,
    requiresScan: item.requiresScan,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    visibility: item.visibility,
    publishAt: item.publishAt,
    audiences: item.audiences ?? [],
    contactNote: item.contactNote,
    notes: item.notes,
  };
}

/** The non-viewer locales' hand-edited/machine-translated title+description, including the item's original primary language if it isn't the viewer's own (H50 extension). */
export function scheduleItemToTranslations(
  item: AdminScheduleItem,
  accountLanguage: Language,
): ScheduleTranslations {
  const translations: ScheduleTranslations = {};
  for (const language of LANGUAGES) {
    if (language === accountLanguage) continue;
    if (language === item.primaryLanguage) {
      translations[language] = { title: item.title, description: item.description };
      continue;
    }
    const title = item.titleI18n[language];
    const description = item.descriptionI18n[language];
    if (title !== undefined || description !== undefined) {
      translations[language] = { title, description };
    }
  }
  return translations;
}

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
  ) => Promise<{ id: number }>;
}) {
  const { t, language: accountLanguage } = useLocale();
  const insets = useSafeAreaInsets();
  // Android has no page-sheet presentation: the modal is full-screen, so its
  // chrome has to clear the status bar itself.
  const sheetTopInset = process.env.EXPO_OS === "android" ? insets.top : 0;
  const [values, setValues] = useState<ScheduleInput>(initial ?? emptyForm());
  const [owners, setOwners] = useState<ScheduleOwner[]>(initialOwners ?? []);
  const [scheduledPublish, setScheduledPublish] = useState(Boolean(initial?.publishAt));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!visible) return;
    setValues(initial ?? emptyForm());
    setOwners(initialOwners ?? []);
    setScheduledPublish(Boolean(initial?.publishAt));
    setTranslations(initialTranslations ?? {});
    setTranslationsOpen(false);
    setError(null);
  }, [visible, initial, initialOwners, initialTranslations]);

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
      setError(t("couldNotTranslate"));
    } finally {
      setTranslating(false);
    }
  }

  async function save() {
    if (!values.title.trim()) {
      setError(t("scheduleSaveError"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await onSubmit(
        {
          ...values,
          title: values.title.trim(),
          publishAt: scheduledPublish ? values.publishAt : null,
        },
        owners.map((owner) =>
          owner.userId !== null
            ? { userId: owner.userId }
            : { freeTextName: owner.freeTextName as string },
        ),
      );
      if (Object.keys(translations).length > 0) {
        await saveScheduleTranslations(result.id, translations);
      }
    } catch {
      setError(t("scheduleSaveError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{
            gap: 22,
            padding: 16,
            paddingBottom: Math.max(32, insets.bottom + 16),
            paddingTop: 16 + sheetTopInset,
          }}
        >
          <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 52 }}>
            <Text
              selectable
              style={{ color: colors.label, fontSize: 20, fontWeight: "700", textAlign: "center" }}
            >
              {scheduleId ? t("scheduleEdit") : t("scheduleAdd")}
            </Text>
          </View>

          <Section title={`${t("scheduleTitleLabel")} · ${languageTag(accountLanguage, t)}`}>
            <TextInput
              accessibilityLabel={t("scheduleTitleLabel")}
              onChangeText={(title) => setValues((current) => ({ ...current, title }))}
              placeholder={t("scheduleTitleLabel")}
              placeholderTextColor={colors.tertiaryLabel}
              style={{ color: colors.label, fontSize: 16, padding: 16 }}
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
                fontSize: 16,
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
                <Text style={{ color: colors.label, flex: 1, fontSize: 16 }}>
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

          <View style={{ gap: 8 }}>
            <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("translationsAndSettings")}
                accessibilityState={{ expanded: translationsOpen }}
                onPress={() => setTranslationsOpen((open) => !open)}
                hitSlop={8}
                style={({ pressed }) => ({
                  alignItems: "center",
                  flex: 1,
                  flexDirection: "row",
                  gap: 6,
                  opacity: pressed ? 0.6 : 1,
                  paddingVertical: 8,
                })}
              >
                <SymbolView
                  name="chevron.right"
                  tintColor={colors.secondaryLabel}
                  size={13}
                  weight="semibold"
                  style={{ transform: [{ rotate: translationsOpen ? "90deg" : "0deg" }] }}
                />
                <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>
                  {t("translationsAndSettings")}
                </Text>
              </Pressable>
              {translateAvailable ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("translateAutomatically")}
                  accessibilityState={{
                    busy: translating,
                    disabled: blankTargetLanguages.length === 0,
                  }}
                  disabled={translating || blankTargetLanguages.length === 0}
                  onPress={() => void autoTranslate()}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    backgroundColor: colors.elevatedSurface,
                    borderCurve: "continuous",
                    borderRadius: 10,
                    flexDirection: "row",
                    gap: 8,
                    opacity:
                      translating || blankTargetLanguages.length === 0 ? 0.5 : pressed ? 0.7 : 1,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                  })}
                >
                  <SymbolView
                    name="character.book.closed"
                    tintColor={colors.accent}
                    size={16}
                    accessible={false}
                  />
                  <Text style={{ color: colors.accent, fontSize: 15, fontWeight: "600" }}>
                    {translating ? t("translatingInProgress") : t("translateAutomatically")}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {translationsOpen
              ? targetLanguages.map((language) => (
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
                        style={{ color: colors.label, fontSize: 16, padding: 16 }}
                        value={translations[language]?.title ?? ""}
                      />
                    </Section>
                    <Section
                      title={`${t("scheduleDescriptionLabel")} · ${languageTag(language, t)}`}
                    >
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
                          fontSize: 16,
                          lineHeight: 22,
                          minHeight: 70,
                          padding: 16,
                          textAlignVertical: "top",
                        }}
                        value={translations[language]?.description ?? ""}
                      />
                    </Section>
                  </View>
                ))
              : null}
          </View>

          <Section title={t("scheduleLocationLabel")}>
            <TextInput
              accessibilityLabel={t("scheduleLocationLabel")}
              onChangeText={(location) =>
                setValues((current) => ({ ...current, location: location || null }))
              }
              placeholder={t("scheduleLocationLabel")}
              placeholderTextColor={colors.tertiaryLabel}
              style={{ color: colors.label, fontSize: 16, padding: 16 }}
              value={values.location ?? ""}
            />
          </Section>

          <View style={{ gap: 8 }}>
            <Text
              accessibilityRole="header"
              style={{
                color: colors.secondaryLabel,
                fontSize: 13,
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
                fontSize: 13,
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
              onChange={(date) =>
                setValues((current) => ({ ...current, endsAt: date.toISOString() }))
              }
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

            <Text style={{ color: colors.secondaryLabel, fontSize: 13, paddingHorizontal: 16 }}>
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
                  <View
                    style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }}
                  />
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

          <Section title={t("scheduleContactNoteLabel")}>
            <TextInput
              accessibilityLabel={t("scheduleContactNoteLabel")}
              onChangeText={(contactNote) =>
                setValues((current) => ({ ...current, contactNote: contactNote || null }))
              }
              placeholder={t("scheduleContactNoteLabel")}
              placeholderTextColor={colors.tertiaryLabel}
              style={{ color: colors.label, fontSize: 16, padding: 16 }}
              value={values.contactNote ?? ""}
            />
          </Section>

          <Section title={t("scheduleNotesLabel")}>
            <TextInput
              accessibilityLabel={t("scheduleNotesLabel")}
              multiline
              onChangeText={(notes) =>
                setValues((current) => ({ ...current, notes: notes || null }))
              }
              placeholder={t("scheduleNotesLabel")}
              placeholderTextColor={colors.tertiaryLabel}
              style={{
                color: colors.label,
                fontSize: 16,
                lineHeight: 22,
                minHeight: 70,
                padding: 16,
                textAlignVertical: "top",
              }}
              value={values.notes ?? ""}
            />
          </Section>

          <OwnersField owners={owners} onChange={setOwners} scheduleId={scheduleId} />

          {error ? (
            <Text
              selectable
              style={{ color: colors.destructive, fontSize: 14, textAlign: "center" }}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <FloatingGlassButton
          top={16 + sheetTopInset}
          side="left"
          icon="xmark"
          accessibilityLabel={t("cancel")}
          onPress={onClose}
        />
        <FloatingGlassButton
          top={16 + sheetTopInset}
          side="right"
          icon="checkmark"
          tintColor={colors.accent}
          accessibilityLabel={t("save")}
          accessibilityState={{ busy: pending }}
          disabled={pending}
          onPress={() => void save()}
        />
      </View>
    </Modal>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 50,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
    >
      <Text
        style={{ color: disabled ? colors.tertiaryLabel : colors.label, flex: 1, fontSize: 16 }}
      >
        {label}
      </Text>
      <Switch disabled={disabled} onValueChange={onChange} value={value} />
    </View>
  );
}

/**
 * Responsible-person picker. In create mode there's no `scheduleId` yet, so
 * additions/removals just mutate local state; the caller assigns
 * `pendingOwnerIds` after the item is created. In edit mode, each tap hits
 * the owner endpoints immediately (mirrors the web admin table's picker).
 */
/** A candidate returned by the owner-candidates search. */
type OwnerCandidate = { id: number; email: string; name: string | null; surname: string | null };

function ownerCandidateName(candidate: OwnerCandidate): string {
  return [candidate.name, candidate.surname].filter(Boolean).join(" ").trim() || candidate.email;
}

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
    <Section title={t("scheduleOwnersLabel")}>
      <View style={{ gap: 8, padding: 16 }}>
        <View
          accessible
          accessibilityLabel={t("scheduleOwnerSearchPlaceholder")}
          style={{
            alignItems: "center",
            backgroundColor: colors.elevatedSurface,
            borderCurve: "continuous",
            borderRadius: 10,
            flexDirection: "row",
            gap: 8,
            minHeight: 36,
            paddingHorizontal: 8,
          }}
        >
          <SymbolView
            name="magnifyingglass"
            tintColor={colors.tertiaryLabel}
            size={15}
            accessible={false}
          />
          <TextInput
            accessibilityLabel={t("scheduleOwnerSearchPlaceholder")}
            editable={mutation === null && !searching}
            onChangeText={(value) => {
              setQuery(value);
              setResults([]);
              setSearched(false);
            }}
            onSubmitEditing={() => void search()}
            placeholder={t("scheduleOwnerSearchPlaceholder")}
            placeholderTextColor={colors.tertiaryLabel}
            returnKeyType="search"
            value={query}
            style={{ color: colors.label, flex: 1, fontSize: 17, minHeight: 36 }}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityLabel={t("cancel")}
              onPress={() => {
                setQuery("");
                setResults([]);
                setSearched(false);
              }}
              hitSlop={8}
            >
              <SymbolView
                name="xmark.circle.fill"
                tintColor={colors.tertiaryLabel}
                size={16}
                accessible={false}
              />
            </Pressable>
          ) : null}
        </View>
        {searchError ? (
          <RequestFeedback error={searchError} onRetry={() => void search()} retrying={searching} />
        ) : null}
      </View>
      {results.map((candidate) => (
        <View key={candidate.id}>
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
            <View style={{ flex: 1 }}>
              <Text selectable numberOfLines={1} style={{ color: colors.label, fontSize: 16 }}>
                {ownerCandidateName(candidate)}
              </Text>
              <Text
                selectable
                numberOfLines={1}
                style={{ color: colors.secondaryLabel, fontSize: 14 }}
              >
                {candidate.email}
              </Text>
            </View>
            {mutation === `add-user:${candidate.id}` ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("scheduleOwnerAdd")}
                disabled={mutation !== null}
                onPress={() => void add(candidate)}
                hitSlop={8}
                style={({ pressed }) => ({
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 44,
                  minWidth: 44,
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Text style={{ color: colors.accent, fontSize: 16 }}>{t("add")}</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
      {!searching && searched && results.length === 0 ? (
        <View style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}>
          <Text style={{ color: colors.tertiaryLabel, fontSize: 14 }}>
            {t("scheduleOwnerSearchEmpty")}
          </Text>
        </View>
      ) : null}
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
          style={{
            backgroundColor: colors.elevatedSurface,
            borderCurve: "continuous",
            borderRadius: 10,
            color: colors.label,
            flex: 1,
            fontSize: 16,
            minHeight: 36,
            paddingHorizontal: 8,
          }}
        />
        {mutation === "add-text" ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("scheduleOwnerAdd")}
            disabled={mutation !== null || !freeTextName.trim()}
            onPress={() => void addFreeText()}
            hitSlop={8}
            style={({ pressed }) => ({
              opacity: pressed || !freeTextName.trim() ? 0.5 : 1,
            })}
          >
            <Text style={{ color: colors.accent, fontSize: 16 }}>{t("add")}</Text>
          </Pressable>
        )}
      </View>
      {owners.length === 0 ? (
        <View style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}>
          <Text style={{ color: colors.tertiaryLabel, fontSize: 14 }}>
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
                numberOfLines={1}
                style={{ color: colors.label, flex: 1, fontSize: 16 }}
              >
                {owner.freeTextName ??
                  ([owner.name, owner.surname].filter(Boolean).join(" ").trim() ||
                    owner.email ||
                    "")}
              </Text>
              {mutation === `remove:${owner.id}` ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <Pressable
                  accessibilityLabel={t("scheduleDelete")}
                  accessibilityRole="button"
                  disabled={mutation !== null}
                  onPress={() => void remove(owner.id)}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 44,
                    minWidth: 44,
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <Text style={{ color: colors.destructive, fontSize: 16 }}>{t("remove")}</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))
      )}
    </Section>
  );
}
