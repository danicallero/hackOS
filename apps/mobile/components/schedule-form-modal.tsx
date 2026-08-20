import { MenuView } from "@expo/ui/community/menu";
import { ACTIVITY_KINDS, type ActivityKind } from "@hackos/shared/activity-kinds";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DateTimeField } from "@/components/date-time-field";
import { FloatingGlassButton, Section } from "@/components/native-ui";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import {
  type AdminScheduleItem,
  addScheduleOwner,
  fetchScheduleOwnerCandidates,
  removeScheduleOwner,
  SCHEDULE_AUDIENCES,
  type ScheduleAudience,
  type ScheduleInput,
  type ScheduleOwner,
  scheduleTypeLabel,
} from "@/lib/schedule";
import { colors } from "@/theme/colors";

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
    audiences: [],
    contactNote: null,
    notes: null,
  };
}

export function scheduleItemToForm(item: AdminScheduleItem): ScheduleInput {
  return {
    title: item.title,
    description: item.description,
    location: item.location,
    type: item.type,
    requiresScan: item.requiresScan,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    visibility: item.visibility,
    publishAt: item.publishAt,
    audiences: item.audiences,
    contactNote: item.contactNote,
    notes: item.notes,
  };
}

/**
 * Admin create/edit form (H59 3c) — same field set and validation as the
 * web app's ScheduleFormModal, not a reduced mobile form.
 */
export function ScheduleFormModal({
  visible,
  onClose,
  initial,
  scheduleId,
  initialOwners,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  /** Present when editing; omit for create. */
  initial?: ScheduleInput;
  scheduleId?: number;
  initialOwners?: ScheduleOwner[];
  onSubmit: (values: ScheduleInput, pendingOwnerIds: number[]) => Promise<void>;
}) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const [values, setValues] = useState<ScheduleInput>(initial ?? emptyForm());
  const [owners, setOwners] = useState<ScheduleOwner[]>(initialOwners ?? []);
  const [scheduledPublish, setScheduledPublish] = useState(Boolean(initial?.publishAt));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setValues(initial ?? emptyForm());
    setOwners(initialOwners ?? []);
    setScheduledPublish(Boolean(initial?.publishAt));
    setError(null);
  }, [visible, initial, initialOwners]);

  async function save() {
    if (!values.title.trim()) {
      setError(t("scheduleSaveError"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(
        {
          ...values,
          title: values.title.trim(),
          publishAt: scheduledPublish ? values.publishAt : null,
        },
        owners.map((owner) => owner.userId),
      );
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
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            gap: 22,
            padding: 16,
            paddingBottom: Math.max(32, insets.bottom + 16),
            paddingTop: 16,
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

          <Section title={t("scheduleTitleLabel")}>
            <TextInput
              accessibilityLabel={t("scheduleTitleLabel")}
              onChangeText={(title) => setValues((current) => ({ ...current, title }))}
              placeholder={t("scheduleTitleLabel")}
              placeholderTextColor={colors.tertiaryLabel}
              style={{ color: colors.label, fontSize: 16, padding: 16 }}
              value={values.title}
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
                setValues((current) => ({ ...current, type: nativeEvent.event as ActivityKind }))
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

          <Section title={t("scheduleDescriptionLabel")}>
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

          <Section>
            <ToggleRow
              label={t("scheduleVisibilityLabel")}
              value={values.visibility === "shown"}
              onChange={(shown) =>
                setValues((current) => ({ ...current, visibility: shown ? "shown" : "hidden" }))
              }
            />
            <View style={{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }} />
            <ToggleRow
              label={t("scheduleRequiresScanLabel")}
              value={values.requiresScan}
              onChange={(requiresScan) => setValues((current) => ({ ...current, requiresScan }))}
            />
          </Section>

          <Section title={t("schedulePublishAtLabel")}>
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
          </Section>

          <Section title={t("scheduleFilterAudience")}>
            {SCHEDULE_AUDIENCES.map((audience, index) => {
              const selected = values.audiences.includes(audience);
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
                    onChange={(next) =>
                      setValues((current) => ({
                        ...current,
                        audiences: next
                          ? [...current.audiences, audience]
                          : current.audiences.filter((a) => a !== audience),
                      }))
                    }
                  />
                </View>
              );
            })}
          </Section>

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
          top={16}
          side="left"
          icon="xmark"
          accessibilityLabel={t("cancel")}
          onPress={onClose}
        />
        <FloatingGlassButton
          top={16}
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
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
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
      <Text style={{ color: colors.label, flex: 1, fontSize: 16 }}>{label}</Text>
      <Switch onValueChange={onChange} value={value} />
    </View>
  );
}

/**
 * Responsible-person picker. In create mode there's no `scheduleId` yet, so
 * additions/removals just mutate local state; the caller assigns
 * `pendingOwnerIds` after the item is created. In edit mode, each tap hits
 * the owner endpoints immediately (mirrors the web admin table's picker).
 */
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
  const [results, setResults] = useState<
    { id: number; email: string; name: string | null; surname: string | null }[]
  >([]);
  const requestId = useRef(0);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const currentRequest = ++requestId.current;
    const handle = setTimeout(async () => {
      try {
        const users = await fetchScheduleOwnerCandidates(query.trim());
        if (currentRequest === requestId.current) setResults(users);
      } catch {
        if (currentRequest === requestId.current) setResults([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const ownerIds = new Set(owners.map((owner) => owner.userId));

  async function add(candidate: {
    id: number;
    email: string;
    name: string | null;
    surname: string | null;
  }) {
    if (ownerIds.has(candidate.id)) return;
    if (scheduleId) await addScheduleOwner(scheduleId, candidate.id);
    onChange([
      ...owners,
      {
        userId: candidate.id,
        name: candidate.name,
        surname: candidate.surname,
        email: candidate.email,
      },
    ]);
    setQuery("");
    setResults([]);
  }

  async function remove(userId: number) {
    if (scheduleId) await removeScheduleOwner(scheduleId, userId);
    onChange(owners.filter((owner) => owner.userId !== userId));
  }

  return (
    <Section title={t("scheduleOwnersLabel")}>
      <View style={{ padding: 16, paddingBottom: results.length > 0 ? 0 : 16 }}>
        <TextInput
          accessibilityLabel={t("scheduleOwnerAdd")}
          onChangeText={setQuery}
          placeholder={t("scheduleOwnerSearchPlaceholder")}
          placeholderTextColor={colors.tertiaryLabel}
          style={{ color: colors.label, fontSize: 16 }}
          value={query}
        />
      </View>
      {results.map((candidate) => (
        <View
          key={candidate.id}
          style={{
            alignItems: "center",
            borderTopColor: colors.separator,
            borderTopWidth: 0.5,
            flexDirection: "row",
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}
        >
          <Text style={{ color: colors.label, flex: 1, fontSize: 15 }}>
            {[candidate.name, candidate.surname].filter(Boolean).join(" ").trim() ||
              candidate.email}
          </Text>
          <Pressable
            accessibilityLabel={t("scheduleOwnerAdd")}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => void add(candidate)}
          >
            <SymbolView name="plus.circle.fill" tintColor={colors.accent} size={20} />
          </Pressable>
        </View>
      ))}
      {owners.length === 0 ? (
        <View style={{ borderTopColor: colors.separator, borderTopWidth: 0.5, padding: 16 }}>
          <Text style={{ color: colors.tertiaryLabel, fontSize: 14 }}>
            {t("scheduleOwnersEmpty")}
          </Text>
        </View>
      ) : (
        owners.map((owner) => (
          <View
            key={owner.userId}
            style={{
              alignItems: "center",
              borderTopColor: colors.separator,
              borderTopWidth: 0.5,
              flexDirection: "row",
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: colors.label, flex: 1, fontSize: 15 }}>
              {[owner.name, owner.surname].filter(Boolean).join(" ").trim() || owner.email}
            </Text>
            <Pressable
              accessibilityLabel={t("scheduleDelete")}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => void remove(owner.userId)}
            >
              <SymbolView name="minus.circle.fill" tintColor={colors.destructive} size={20} />
            </Pressable>
          </View>
        ))
      )}
    </Section>
  );
}
