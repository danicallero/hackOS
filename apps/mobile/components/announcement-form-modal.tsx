import {
  emptyAnnouncementForm,
  type TargetingMode,
  targetingModeOf,
} from "@hackos/shared/announcement-form";
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { MenuView } from "@/components/app-menu";
import { DateTimeField } from "@/components/date-time-field";
import {
  FormModalPeoplePicker,
  FormModalShell,
  FormModalTranslationsDisclosure,
} from "@/components/form-modal-sections";
import { Section, ToggleRow } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView } from "@/components/symbol";
import {
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_SCREEN_PLACEMENTS,
  type AnnouncementChannel,
  type AnnouncementInput,
  type AnnouncementLanguage,
  type AnnouncementRecipient,
  type AnnouncementScreenPlacement,
  fetchAnnouncementRecipientCandidates,
  fetchAnnouncementTargetingOptions,
  fetchFoodIntolerances,
  fetchTranslateAvailability,
  translateAnnouncement,
} from "@/lib/announcements-admin";
import { useLocale } from "@/lib/i18n";
import { colors, type } from "@/theme";

function channelLabel(channel: AnnouncementChannel, t: ReturnType<typeof useLocale>["t"]): string {
  switch (channel) {
    case "in_app":
      return t("notificationsInApp");
    case "email":
      return t("emailLabel");
    case "push":
      return t("notificationsPush");
  }
}

function placementLabel(
  placement: AnnouncementScreenPlacement,
  t: ReturnType<typeof useLocale>["t"],
): string {
  switch (placement) {
    case "none":
      return t("announcementPlacementNone");
    case "embedded":
      return t("announcementPlacementEmbedded");
    case "fullscreen":
      return t("announcementPlacementFullscreen");
  }
}

function targetingLabel(mode: TargetingMode, t: ReturnType<typeof useLocale>["t"]): string {
  switch (mode) {
    case "everyone":
      return t("announcementTargetingEveryone");
    case "roles":
      return t("announcementTargetingRoles");
    case "specific":
      return t("announcementTargetingSpecific");
  }
}

export { announcementToForm } from "@hackos/shared/announcement-form";

/**
 * Admin create/edit form (H50, DELTA 0601) — same field set and validation
 * as the web app's AnnouncementFormModal, not a reduced mobile form (mirrors
 * ScheduleFormModal's own precedent for this app).
 */
export function AnnouncementFormModal({
  visible,
  onClose,
  initial,
  initialRecipients,
  announcementId,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  /** Present when editing; omit for create. */
  initial?: AnnouncementInput;
  initialRecipients?: AnnouncementRecipient[];
  announcementId?: number;
  onSubmit: (values: AnnouncementInput) => Promise<void>;
}) {
  const { t, language } = useLocale();
  const [values, setValues] = useState<AnnouncementInput>(initial ?? emptyAnnouncementForm());
  const [recipients, setRecipients] = useState<AnnouncementRecipient[]>(initialRecipients ?? []);
  const [roles, setRoles] = useState<Array<{ id: number; name: string }>>([]);
  const [intolerances, setIntolerances] = useState<
    Array<{ id: number; label: Record<string, string> }>
  >([]);
  const [targetingMode, setTargetingModeState] = useState<TargetingMode>(
    targetingModeOf(initial ?? emptyAnnouncementForm()),
  );
  const [scheduledSend, setScheduledSend] = useState(Boolean(initial?.publishAt));
  const [scheduledExpiry, setScheduledExpiry] = useState(Boolean(initial?.expiresAt));
  // Lets each language's Title field's "next" key jump straight into its own
  // Message field — a multiline field's own return key inserts a newline
  // instead, so chaining stops there rather than trying to jump languages.
  const bodyRefs = useRef<Record<AnnouncementLanguage, TextInput | null>>({
    es: null,
    gl: null,
    en: null,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hidden by default: only shown once the availability check confirms a
  // provider is configured, so the form works identically (manual entry
  // only) with no translation provider set up at all.
  const [translateAvailable, setTranslateAvailable] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);

  const canTargetSpecific = values.screenPlacement === "none";

  useEffect(() => {
    if (!visible) return;
    const next = initial ?? emptyAnnouncementForm();
    setValues(next);
    setRecipients(initialRecipients ?? []);
    setTargetingModeState(targetingModeOf(next));
    setScheduledSend(Boolean(next.publishAt));
    setScheduledExpiry(Boolean(next.expiresAt));
    setTranslationsOpen(false);
    setError(null);
  }, [visible, initial, initialRecipients]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void fetchTranslateAvailability()
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

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void Promise.all([fetchAnnouncementTargetingOptions(), fetchFoodIntolerances()])
      .then(([options, dictionary]) => {
        if (cancelled) return;
        setRoles(options.roles);
        setIntolerances(dictionary);
      })
      .catch(() => {
        if (!cancelled) setError(t("couldNotLoadAnnouncementTargeting"));
      });
    return () => {
      cancelled = true;
    };
  }, [t, visible]);

  /**
   * Staff can write the primary content in whichever of the three languages
   * comes naturally — this picks the first non-empty language as the source
   * and fills every still-empty one from it, never overwriting a field
   * someone already typed into.
   */
  async function autoTranslate() {
    const content: Record<AnnouncementLanguage, { title: string; body: string }> = {
      es: { title: values.title, body: values.body },
      gl: values.translations.gl ?? { title: "", body: "" },
      en: values.translations.en ?? { title: "", body: "" },
    };
    const isFilled = (language: AnnouncementLanguage) =>
      Boolean(content[language].title.trim() && content[language].body.trim());
    const source = (["es", "gl", "en"] as const).find(isFilled);
    const targets = (["es", "gl", "en"] as const).filter((language) => !isFilled(language));
    if (!source || targets.length === 0) return;
    setTranslating(true);
    setError(null);
    try {
      const translations = await translateAnnouncement({
        title: content[source].title,
        body: content[source].body,
        sourceLanguage: source,
        targetLanguages: targets,
      });
      setValues((current) => ({
        ...current,
        title: translations.es?.title ?? current.title,
        body: translations.es?.body ?? current.body,
        translations: { ...current.translations, ...translations },
      }));
    } catch {
      setError(t("couldNotTranslate"));
    } finally {
      setTranslating(false);
    }
  }

  function setTargetingMode(mode: TargetingMode) {
    setTargetingModeState(mode);
    setValues((current) => ({
      ...current,
      roleIds: mode === "roles" ? current.roleIds : [],
      intoleranceIds: mode === "roles" ? current.intoleranceIds : [],
      recipientUserIds: mode === "specific" ? current.recipientUserIds : [],
    }));
    if (mode !== "specific") setRecipients([]);
  }

  function setScreenPlacement(screenPlacement: AnnouncementScreenPlacement) {
    if (screenPlacement !== "none" && targetingMode === "specific") {
      setTargetingModeState("everyone");
      setRecipients([]);
    }
    if (screenPlacement === "none") setScheduledExpiry(false);
    setValues((current) => ({
      ...current,
      screenPlacement,
      recipientUserIds: screenPlacement === "none" ? current.recipientUserIds : [],
      expiresAt: screenPlacement === "none" ? null : current.expiresAt,
    }));
  }

  async function save() {
    const languages = ["es", "gl", "en"] as const;
    const completeLanguages = languages.filter((language) => {
      const translation = values.translations[language];
      return Boolean(translation?.title.trim() && translation.body.trim());
    });
    const incompleteLanguage = languages.find((language) => {
      const translation = values.translations[language];
      const hasContent = Boolean(translation?.title.trim() || translation?.body.trim());
      const isComplete = Boolean(translation?.title.trim() && translation.body.trim());
      return hasContent && !isComplete;
    });
    if (completeLanguages.length === 0 || incompleteLanguage) {
      setError(t("announcementTranslationsRequired"));
      return;
    }
    const translations = Object.fromEntries(
      completeLanguages.map((language) => [language, values.translations[language]]),
    ) as AnnouncementInput["translations"];
    const primaryLanguage = completeLanguages[0];
    const primary = values.translations[primaryLanguage];
    if (!primary) {
      setError(t("announcementSaveError"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        ...values,
        title: primary.title.trim(),
        body: primary.body.trim(),
        translations,
        publishAt: scheduledSend ? values.publishAt : null,
        expiresAt: values.screenPlacement !== "none" && scheduledExpiry ? values.expiresAt : null,
      });
    } catch {
      setError(t("announcementSaveError"));
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
      title={announcementId ? t("announcementEdit") : t("announcementAdd")}
    >
      <Section title={`${t("announcementTitleLabel")} · ${t("spanishTag")}`}>
        <TextInput
          accessibilityLabel={t("announcementTitleLabel")}
          onChangeText={(title) =>
            setValues((current) => ({
              ...current,
              title,
              translations: { ...current.translations, es: { title, body: current.body } },
            }))
          }
          onSubmitEditing={() => bodyRefs.current.es?.focus()}
          placeholder={t("announcementTitleLabel")}
          placeholderTextColor={colors.tertiaryLabel}
          returnKeyType="next"
          style={{ color: colors.label, fontSize: type.callout.fontSize, padding: 16 }}
          value={values.title}
        />
      </Section>

      <Section title={`${t("announcementBodyLabel")} · ${t("spanishTag")}`}>
        <TextInput
          ref={(r) => {
            bodyRefs.current.es = r;
          }}
          accessibilityLabel={t("announcementBodyLabel")}
          multiline
          onChangeText={(body) =>
            setValues((current) => ({
              ...current,
              body,
              translations: { ...current.translations, es: { title: current.title, body } },
            }))
          }
          placeholder={t("announcementBodyLabel")}
          placeholderTextColor={colors.tertiaryLabel}
          style={{
            color: colors.label,
            fontSize: type.callout.fontSize,
            lineHeight: 22,
            minHeight: 90,
            padding: 16,
            textAlignVertical: "top",
          }}
          value={values.body}
        />
      </Section>

      <FormModalTranslationsDisclosure
        expanded={translationsOpen}
        onToggle={() => setTranslationsOpen((open) => !open)}
        onTranslate={() => void autoTranslate()}
        translateAccessibilityState={{ busy: translating }}
        translateAvailable={translateAvailable}
        translateButtonStyle={{ minHeight: 44, paddingHorizontal: 16 }}
        translateDisabled={translating}
        translating={translating}
      >
        {(["gl", "en"] as const).map((language) => (
          <View key={language} style={{ gap: 8 }}>
            <Section
              title={`${t("announcementTitleLabel")} · ${t(language === "gl" ? "galicianTag" : "englishTag")}`}
            >
              <TextInput
                accessibilityLabel={t("announcementTitleLabel")}
                onChangeText={(title) =>
                  setValues((current) => ({
                    ...current,
                    translations: {
                      ...current.translations,
                      [language]: {
                        title,
                        body: current.translations[language]?.body ?? "",
                      },
                    },
                  }))
                }
                onSubmitEditing={() => bodyRefs.current[language]?.focus()}
                placeholderTextColor={colors.tertiaryLabel}
                returnKeyType="next"
                style={{
                  color: colors.label,
                  fontSize: type.callout.fontSize,
                  padding: 16,
                }}
                value={values.translations[language]?.title ?? ""}
              />
            </Section>
            <Section
              title={`${t("announcementBodyLabel")} · ${t(language === "gl" ? "galicianTag" : "englishTag")}`}
            >
              <TextInput
                ref={(r) => {
                  bodyRefs.current[language] = r;
                }}
                accessibilityLabel={t("announcementBodyLabel")}
                multiline
                onChangeText={(body) =>
                  setValues((current) => ({
                    ...current,
                    translations: {
                      ...current.translations,
                      [language]: {
                        title: current.translations[language]?.title ?? "",
                        body,
                      },
                    },
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
                value={values.translations[language]?.body ?? ""}
              />
            </Section>
          </View>
        ))}
      </FormModalTranslationsDisclosure>

      <Section title={t("announcementScreenPlacementLabel")}>
        <MenuView
          actions={ANNOUNCEMENT_SCREEN_PLACEMENTS.map((placement) => ({
            id: placement,
            title: placementLabel(placement, t),
            state: values.screenPlacement === placement ? ("on" as const) : ("off" as const),
          }))}
          onPressAction={({ nativeEvent }) =>
            setScreenPlacement(nativeEvent.event as AnnouncementScreenPlacement)
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
              {placementLabel(values.screenPlacement, t)}
            </Text>
            <SymbolView
              name="chevron.up.chevron.down"
              tintColor={colors.secondaryLabel}
              size={14}
            />
          </View>
        </MenuView>
      </Section>

      <Section>
        <ToggleRow
          label={t("announcementNotifyLabel")}
          value={values.notifyUsers}
          onChange={(notifyUsers) => setValues((current) => ({ ...current, notifyUsers }))}
        />
      </Section>
      <Text
        style={{
          color: colors.secondaryLabel,
          fontSize: type.footnote.fontSize,
          paddingHorizontal: 16,
        }}
      >
        {t("announcementNotifyHelp")}
      </Text>

      {values.notifyUsers ? (
        <>
          <Section title={t("announcementChannelsLabel")}>
            {ANNOUNCEMENT_CHANNELS.map((channel, index) => (
              <View key={channel}>
                {index > 0 ? (
                  <View
                    style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }}
                  />
                ) : null}
                <ToggleRow
                  label={channelLabel(channel, t)}
                  value={values.channels.includes(channel)}
                  onChange={(checked) =>
                    setValues((current) => ({
                      ...current,
                      channels: checked
                        ? [...current.channels, channel]
                        : current.channels.filter((c) => c !== channel),
                    }))
                  }
                />
              </View>
            ))}
          </Section>

          <Section title={t("announcementTargetingLabel")}>
            <MenuView
              actions={(["everyone", "roles", "specific"] as TargetingMode[]).map((mode) => ({
                id: mode,
                title: targetingLabel(mode, t),
                attributes:
                  mode === "specific" && !canTargetSpecific ? { disabled: true } : undefined,
                state: targetingMode === mode ? ("on" as const) : ("off" as const),
              }))}
              onPressAction={({ nativeEvent }) =>
                setTargetingMode(nativeEvent.event as TargetingMode)
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
                  {targetingLabel(targetingMode, t)}
                </Text>
                <SymbolView
                  name="chevron.up.chevron.down"
                  tintColor={colors.secondaryLabel}
                  size={14}
                />
              </View>
            </MenuView>
            {!canTargetSpecific ? (
              <View style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}>
                <Text style={{ color: colors.tertiaryLabel, fontSize: type.footnote.fontSize }}>
                  {t("announcementScreenTargetingDisabledHint")}
                </Text>
              </View>
            ) : null}
          </Section>

          {targetingMode === "roles" ? (
            <Section>
              <Text
                style={{
                  color: colors.secondaryLabel,
                  fontSize: type.footnote.fontSize,
                  padding: 16,
                  paddingBottom: 8,
                }}
              >
                {t("announcementRolesLabel")}
              </Text>
              {roles.map((role, index) => (
                <View key={role.id}>
                  {index > 0 ? (
                    <View
                      style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }}
                    />
                  ) : null}
                  <ToggleRow
                    label={role.name}
                    value={values.roleIds.includes(role.id)}
                    onChange={(checked) =>
                      setValues((current) => ({
                        ...current,
                        roleIds: checked
                          ? [...current.roleIds, role.id]
                          : current.roleIds.filter((id) => id !== role.id),
                      }))
                    }
                  />
                </View>
              ))}
              <Text
                style={{
                  color: colors.secondaryLabel,
                  fontSize: type.footnote.fontSize,
                  padding: 16,
                  paddingBottom: 8,
                }}
              >
                {t("foodIntolerances")}
              </Text>
              {intolerances.map((intolerance) => (
                <View key={intolerance.id}>
                  <View
                    style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }}
                  />
                  <ToggleRow
                    label={
                      intolerance.label[language] ??
                      intolerance.label.es ??
                      intolerance.label.en ??
                      String(intolerance.id)
                    }
                    value={values.intoleranceIds.includes(intolerance.id)}
                    onChange={(checked) =>
                      setValues((current) => ({
                        ...current,
                        intoleranceIds: checked
                          ? [...current.intoleranceIds, intolerance.id]
                          : current.intoleranceIds.filter((id) => id !== intolerance.id),
                      }))
                    }
                  />
                </View>
              ))}
            </Section>
          ) : null}

          {targetingMode === "specific" ? (
            <RecipientsField
              recipients={recipients}
              onChange={(next) => {
                setRecipients(next);
                setValues((current) => ({
                  ...current,
                  recipientUserIds: next.map((recipient) => recipient.id),
                }));
              }}
            />
          ) : null}
        </>
      ) : null}

      <Section title={t("announcementSendAtLabel")}>
        <ToggleRow
          label={
            values.screenPlacement === "none"
              ? t("announcementScheduleSendLabel")
              : t("announcementScheduleVisibleFromLabel")
          }
          value={scheduledSend}
          onChange={(next) => {
            setScheduledSend(next);
            setValues((current) => ({
              ...current,
              publishAt: next ? (current.publishAt ?? new Date().toISOString()) : null,
            }));
          }}
        />
        {scheduledSend ? (
          <View style={{ padding: 16, paddingTop: 0 }}>
            <DateTimeField
              dateAccessibilityLabel={t("announcementSendAtLabel")}
              timeAccessibilityLabel={t("announcementSendAtLabel")}
              value={values.publishAt ? new Date(values.publishAt) : new Date()}
              onChange={(date) =>
                setValues((current) => ({ ...current, publishAt: date.toISOString() }))
              }
            />
          </View>
        ) : null}
      </Section>

      {values.screenPlacement !== "none" ? (
        <Section title={t("announcementScheduleVisibleUntilLabel")}>
          <ToggleRow
            label={t("announcementScheduleVisibleUntilLabel")}
            value={scheduledExpiry}
            onChange={(next) => {
              setScheduledExpiry(next);
              setValues((current) => ({
                ...current,
                expiresAt: next
                  ? (current.expiresAt ?? new Date(Date.now() + 60 * 60_000).toISOString())
                  : null,
              }));
            }}
          />
          {scheduledExpiry ? (
            <View style={{ padding: 16, paddingTop: 0 }}>
              <DateTimeField
                dateAccessibilityLabel={t("announcementScheduleVisibleUntilLabel")}
                timeAccessibilityLabel={t("announcementScheduleVisibleUntilLabel")}
                value={values.expiresAt ? new Date(values.expiresAt) : new Date()}
                onChange={(date) =>
                  setValues((current) => ({ ...current, expiresAt: date.toISOString() }))
                }
              />
            </View>
          ) : null}
        </Section>
      ) : (
        <Text
          style={{
            color: colors.secondaryLabel,
            fontSize: type.footnote.fontSize,
            paddingHorizontal: 16,
          }}
        >
          {t("announcementNotifyOnlyHint")}
        </Text>
      )}

      {error ? (
        <Text
          selectable
          style={{
            color: colors.destructive,
            fontSize: type.compact.fontSize,
            textAlign: "center",
          }}
        >
          {error}
        </Text>
      ) : null}
    </FormModalShell>
  );
}

/** Specific-recipient picker — search + add + removable list, no free-text (unlike schedule owners, a recipient must be a real account). */
function RecipientsField({
  recipients,
  onChange,
}: {
  recipients: AnnouncementRecipient[];
  onChange: (recipients: AnnouncementRecipient[]) => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AnnouncementRecipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<Error | null>(null);
  const requestId = useRef(0);

  const recipientIds = new Set(recipients.map((recipient) => recipient.id));

  async function search() {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const currentRequest = ++requestId.current;
    setSearching(true);
    setSearchError(null);
    try {
      const users = await fetchAnnouncementRecipientCandidates(trimmed);
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

  function add(candidate: AnnouncementRecipient) {
    if (recipientIds.has(candidate.id)) return;
    onChange([...recipients, candidate]);
  }

  function remove(id: number) {
    onChange(recipients.filter((recipient) => recipient.id !== id));
  }

  return (
    <FormModalPeoplePicker
      title={t("announcementRecipientsLabel")}
      accessibilityLabel={t("announcementRecipientSearchPlaceholder")}
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
      editable={!searching}
      searching={searching}
      searched={searched}
      searchError={searchError}
      candidates={results}
      emptyResultsLabel={t("announcementRecipientSearchEmpty")}
      renderCandidateAction={(candidate) => (
        <PressableFeedback
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={t("announcementRecipientAdd")}
          disabled={recipientIds.has(candidate.id)}
          onPress={() => add(candidate)}
          hitSlop={8}
          style={{
            alignItems: "center",
            justifyContent: "center",
            minHeight: 44,
            minWidth: 44,
          }}
        >
          <Text style={{ color: colors.accent, fontSize: type.callout.fontSize }}>{t("add")}</Text>
        </PressableFeedback>
      )}
    >
      {recipients.length === 0 ? (
        <View style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}>
          <Text style={{ color: colors.tertiaryLabel, fontSize: type.compact.fontSize }}>
            {t("announcementNoRecipientsYet")}
          </Text>
        </View>
      ) : (
        recipients.map((recipient) => (
          <View key={recipient.id}>
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
                style={{ color: colors.label, flex: 1, fontSize: type.callout.fontSize }}
              >
                {[recipient.name, recipient.surname].filter(Boolean).join(" ").trim() ||
                  recipient.email}
              </Text>
              <PressableFeedback
                feedback="opacity"
                accessibilityLabel={t("remove")}
                accessibilityRole="button"
                onPress={() => remove(recipient.id)}
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
            </View>
          </View>
        ))
      )}
    </FormModalPeoplePicker>
  );
}
