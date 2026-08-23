import { MenuView } from "@expo/ui/community/menu";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DateTimeField } from "@/components/date-time-field";
import { FloatingGlassButton, Section } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import {
  type AdminAnnouncement,
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_SCREEN_PLACEMENTS,
  type AnnouncementAudience,
  type AnnouncementChannel,
  type AnnouncementInput,
  type AnnouncementLanguage,
  type AnnouncementRecipient,
  type AnnouncementScreenPlacement,
  fetchAnnouncementRecipientCandidates,
  fetchTranslateAvailability,
  translateAnnouncement,
} from "@/lib/announcements-admin";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

function audienceLabel(
  audience: AnnouncementAudience,
  t: ReturnType<typeof useLocale>["t"],
): string {
  switch (audience) {
    case "sponsor":
      return t("scheduleAudienceSponsor");
    case "participant":
      return t("scheduleAudienceParticipant");
    case "mentor":
      return t("scheduleAudienceMentor");
    case "staff":
      return t("scheduleAudienceStaff");
  }
}

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

type TargetingMode = "everyone" | "audience" | "specific";

function targetingLabel(mode: TargetingMode, t: ReturnType<typeof useLocale>["t"]): string {
  switch (mode) {
    case "everyone":
      return t("announcementTargetingEveryone");
    case "audience":
      return t("announcementTargetingAudience");
    case "specific":
      return t("announcementTargetingSpecific");
  }
}

function emptyForm(): AnnouncementInput {
  return {
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
}

export function announcementToForm(a: AdminAnnouncement): AnnouncementInput {
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

function targetingModeOf(values: AnnouncementInput): TargetingMode {
  if (values.recipientUserIds.length > 0) return "specific";
  if (values.audiences.length > 0) return "audience";
  return "everyone";
}

/**
 * Admin create/edit form (H50, DELTA 0722) — same field set and validation
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
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const sheetTopInset = process.env.EXPO_OS === "android" ? insets.top : 0;
  const [values, setValues] = useState<AnnouncementInput>(initial ?? emptyForm());
  const [recipients, setRecipients] = useState<AnnouncementRecipient[]>(initialRecipients ?? []);
  const [targetingMode, setTargetingModeState] = useState<TargetingMode>(
    targetingModeOf(initial ?? emptyForm()),
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

  const canTargetSpecific = values.screenPlacement === "none";

  useEffect(() => {
    if (!visible) return;
    const next = initial ?? emptyForm();
    setValues(next);
    setRecipients(initialRecipients ?? []);
    setTargetingModeState(targetingModeOf(next));
    setScheduledSend(Boolean(next.publishAt));
    setScheduledExpiry(Boolean(next.expiresAt));
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
      audiences: mode === "audience" ? current.audiences : [],
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
    if (!values.title.trim() || !values.body.trim()) {
      setError(t("announcementSaveError"));
      return;
    }
    const missingTranslation = (["es", "gl", "en"] as const).find(
      (language) =>
        !values.translations[language]?.title.trim() || !values.translations[language]?.body.trim(),
    );
    if (missingTranslation) {
      setError(t("announcementTranslationsRequired"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        ...values,
        title: values.title.trim(),
        body: values.body.trim(),
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
              {announcementId ? t("announcementEdit") : t("announcementAdd")}
            </Text>
          </View>

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
              style={{ color: colors.label, fontSize: 16, padding: 16 }}
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
                fontSize: 16,
                lineHeight: 22,
                minHeight: 90,
                padding: 16,
                textAlignVertical: "top",
              }}
              value={values.body}
            />
          </Section>

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
                        [language]: { title, body: current.translations[language]?.body ?? "" },
                      },
                    }))
                  }
                  onSubmitEditing={() => bodyRefs.current[language]?.focus()}
                  placeholderTextColor={colors.tertiaryLabel}
                  returnKeyType="next"
                  style={{ color: colors.label, fontSize: 16, padding: 16 }}
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
                        [language]: { title: current.translations[language]?.title ?? "", body },
                      },
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
                  value={values.translations[language]?.body ?? ""}
                />
              </Section>
            </View>
          ))}

          {translateAvailable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("translateAutomatically")}
              accessibilityState={{ busy: translating }}
              disabled={translating}
              onPress={() => void autoTranslate()}
              style={({ pressed }) => ({
                alignItems: "center",
                alignSelf: "center",
                backgroundColor: colors.elevatedSurface,
                borderCurve: "continuous",
                borderRadius: 10,
                flexDirection: "row",
                gap: 8,
                opacity: translating ? 0.6 : pressed ? 0.7 : 1,
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
                <Text style={{ color: colors.label, flex: 1, fontSize: 16 }}>
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
          <Text style={{ color: colors.secondaryLabel, fontSize: 13, paddingHorizontal: 16 }}>
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
                  actions={(["everyone", "audience", "specific"] as TargetingMode[]).map(
                    (mode) => ({
                      id: mode,
                      title: targetingLabel(mode, t),
                      attributes:
                        mode === "specific" && !canTargetSpecific ? { disabled: true } : undefined,
                      state: targetingMode === mode ? ("on" as const) : ("off" as const),
                    }),
                  )}
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
                    <Text style={{ color: colors.label, flex: 1, fontSize: 16 }}>
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
                  <View
                    style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}
                  >
                    <Text style={{ color: colors.tertiaryLabel, fontSize: 13 }}>
                      {t("announcementScreenTargetingDisabledHint")}
                    </Text>
                  </View>
                ) : null}
              </Section>

              {targetingMode === "audience" ? (
                <Section>
                  {ANNOUNCEMENT_AUDIENCES.map((audience, index) => (
                    <View key={audience}>
                      {index > 0 ? (
                        <View
                          style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }}
                        />
                      ) : null}
                      <ToggleRow
                        label={audienceLabel(audience, t)}
                        value={values.audiences.includes(audience)}
                        onChange={(checked) =>
                          setValues((current) => ({
                            ...current,
                            audiences: checked
                              ? [...current.audiences, audience]
                              : current.audiences.filter((a) => a !== audience),
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
            <Text style={{ color: colors.secondaryLabel, fontSize: 13, paddingHorizontal: 16 }}>
              {t("announcementNotifyOnlyHint")}
            </Text>
          )}

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
    <Section title={t("announcementRecipientsLabel")}>
      <View style={{ gap: 8, padding: 16 }}>
        <View
          accessible
          accessibilityLabel={t("announcementRecipientSearchPlaceholder")}
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
            accessibilityLabel={t("announcementRecipientSearchPlaceholder")}
            editable={!searching}
            onChangeText={(value) => {
              setQuery(value);
              setResults([]);
              setSearched(false);
            }}
            onSubmitEditing={() => void search()}
            placeholder={t("announcementRecipientSearchPlaceholder")}
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
                {[candidate.name, candidate.surname].filter(Boolean).join(" ").trim() ||
                  candidate.email}
              </Text>
              <Text
                selectable
                numberOfLines={1}
                style={{ color: colors.secondaryLabel, fontSize: 14 }}
              >
                {candidate.email}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("announcementRecipientAdd")}
              disabled={recipientIds.has(candidate.id)}
              onPress={() => add(candidate)}
              hitSlop={8}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                minHeight: 44,
                minWidth: 44,
                opacity: recipientIds.has(candidate.id) ? 0.3 : pressed ? 0.5 : 1,
              })}
            >
              <Text style={{ color: colors.accent, fontSize: 16 }}>{t("add")}</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {!searching && searched && results.length === 0 ? (
        <View style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}>
          <Text style={{ color: colors.tertiaryLabel, fontSize: 14 }}>
            {t("announcementRecipientSearchEmpty")}
          </Text>
        </View>
      ) : null}
      {recipients.length === 0 ? (
        <View style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}>
          <Text style={{ color: colors.tertiaryLabel, fontSize: 14 }}>
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
                style={{ color: colors.label, flex: 1, fontSize: 16 }}
              >
                {[recipient.name, recipient.surname].filter(Boolean).join(" ").trim() ||
                  recipient.email}
              </Text>
              <Pressable
                accessibilityLabel={t("remove")}
                accessibilityRole="button"
                onPress={() => remove(recipient.id)}
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
            </View>
          </View>
        ))
      )}
    </Section>
  );
}
