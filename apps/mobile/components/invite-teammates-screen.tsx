import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useEffect, useLayoutEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { Section, Separator } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { CircleButton } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import type { DiaryEntry, DiaryPerson } from "@/lib/diary";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { type NativeProject, projectMutation } from "@/lib/projects";
import { colors } from "@/theme/colors";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An email typed in, or a diary contact (#935) invited by account. */
interface Recipient {
  email?: string;
  contact?: DiaryPerson;
  error?: Error;
}
const recipientKey = (item: Recipient) =>
  item.contact ? `user:${item.contact.userId}` : `email:${item.email?.toLowerCase()}`;
const recipientLabel = (item: Recipient) => item.contact?.displayName ?? item.email ?? "";

/**
 * H19: invite several teammates at once, like Photos' "Invite Participants":
 * round close and confirm in the header, an "Add:" field that turns each email
 * into a row, and the server's reason shown on the row that was refused.
 * People met at the event (badge scans in the diary) are suggested below the
 * field, filtered by what is typed, so most invites need no email at all.
 */
export function InviteTeammatesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const [draft, setDraft] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState<DiaryPerson[]>([]);
  useEffect(() => {
    // Suggestions are optional: a failed read leaves the email field as is.
    void Promise.all([
      apiFetch<{ items: DiaryEntry[] }>("/api/me/diary"),
      apiFetch<NativeProject>(`/api/me/projects/${id}`).catch(() => null),
    ])
      .then(([diary, project]) => {
        const members = new Set(
          (project?.members ?? [])
            .filter((member) => member.status !== "declined")
            .map((member) => member.userId),
        );
        setContacts(
          (diary?.items ?? []).flatMap((entry) =>
            entry.person && !members.has(entry.person.userId) ? [entry.person] : [],
          ),
        );
      })
      .catch(() => {});
  }, [id]);
  const draftValid = EMAIL.test(draft.trim());
  const needle = draft.trim().toLowerCase();
  const suggestions = contacts.filter(
    (person) =>
      !needle ||
      person.displayName.toLowerCase().includes(needle) ||
      person.headline?.toLowerCase().includes(needle),
  );
  function include(next: Recipient) {
    setRecipients((current) =>
      current.some((item) => recipientKey(item) === recipientKey(next))
        ? current
        : [...current, next],
    );
  }
  function add() {
    const email = draft.trim();
    if (!EMAIL.test(email)) return;
    include({ email });
    setDraft("");
  }
  function toggleContact(person: DiaryPerson) {
    const key = recipientKey({ contact: person });
    if (recipients.some((item) => recipientKey(item) === key))
      setRecipients((current) => current.filter((item) => recipientKey(item) !== key));
    else include({ contact: person });
  }
  async function confirm() {
    const pending = [...recipients, ...(draftValid ? [{ email: draft.trim() }] : [])].filter(
      (item, index, all) =>
        all.findIndex((other) => recipientKey(other) === recipientKey(item)) === index,
    );
    if (pending.length === 0 || busy) return;
    setBusy(true);
    const failed: Recipient[] = [];
    for (const item of pending) {
      try {
        await projectMutation(
          `/api/me/projects/${id}/invites`,
          "POST",
          item.contact ? { userId: item.contact.userId } : { email: item.email },
        );
      } catch (cause) {
        failed.push({ ...item, error: cause as Error });
      }
    }
    setBusy(false);
    setDraft("");
    setRecipients(failed);
    if (failed.length === 0) {
      void haptic("success");
      router.back();
    }
  }
  const canConfirm = (recipients.length > 0 || draftValid) && !busy;
  const glass = isRealLiquidGlassAvailable();
  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("projectInvite"),
      // iOS 26 draws the native toolbar buttons below as perfect glass circles.
      ...(glass
        ? { headerLeft: undefined, headerRight: undefined }
        : {
            headerLeft: () => (
              <CircleButton icon="xmark" label={t("cancel")} onPress={() => router.back()} />
            ),
            headerRight: () => (
              <CircleButton
                icon="checkmark"
                label={t("projectSend")}
                prominent
                disabled={!canConfirm}
                onPress={() => void confirm()}
              />
            ),
          }),
    });
  });
  return (
    <>
      {glass ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              separateBackground
              icon="xmark"
              accessibilityLabel={t("cancel")}
              onPress={() => router.back()}
            />
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              separateBackground
              variant="prominent"
              icon="checkmark"
              accessibilityLabel={t("projectSend")}
              disabled={!canConfirm}
              onPress={() => void confirm()}
            />
          </Stack.Toolbar>
        </>
      ) : null}
      <ScrollView
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
        style={{ backgroundColor: colors.surface }}
      >
        <View
          style={{
            alignItems: "center",
            borderBottomColor: colors.separator,
            borderBottomWidth: 0.5,
            flexDirection: "row",
            gap: 8,
            minHeight: 56,
            paddingHorizontal: 20,
          }}
        >
          <Text style={{ color: colors.secondaryLabel, fontSize: 17 }}>{`${t("add")}:`}</Text>
          <TextInput
            accessibilityLabel={t("projectEmail")}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            autoFocus
            editable={!busy}
            keyboardType="email-address"
            onChangeText={setDraft}
            onSubmitEditing={add}
            placeholder="name@example.com"
            placeholderTextColor={colors.tertiaryLabel}
            returnKeyType="next"
            style={{ color: colors.label, flex: 1, fontSize: 17, minHeight: 44, padding: 0 }}
            textContentType="emailAddress"
            value={draft}
          />
          <CircleButton
            icon="plus"
            label={t("add")}
            filled
            disabled={!draftValid || busy}
            onPress={add}
            size={34}
          />
        </View>
        {recipients.length > 0 ? (
          <View style={{ padding: 16 }}>
            <Section>
              {recipients.map((recipient, index) => (
                <View key={recipientKey(recipient)}>
                  {index > 0 ? <Separator /> : null}
                  <View style={{ gap: 6, paddingHorizontal: 16, paddingVertical: 10 }}>
                    <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
                      {recipient.contact ? (
                        <PersonAvatar
                          size={28}
                          name={recipient.contact.displayName}
                          uri={recipient.contact.photoUrl}
                        />
                      ) : null}
                      <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>
                        {recipientLabel(recipient)}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t("remove")} ${recipientLabel(recipient)}`}
                        hitSlop={10}
                        onPress={() =>
                          setRecipients((current) =>
                            current.filter(
                              (item) => recipientKey(item) !== recipientKey(recipient),
                            ),
                          )
                        }
                      >
                        <SymbolView
                          name="xmark.circle.fill"
                          tintColor={colors.tertiaryLabel}
                          size={20}
                          accessible={false}
                        />
                      </Pressable>
                    </View>
                    {recipient.error ? <RequestFeedback error={recipient.error} /> : null}
                  </View>
                </View>
              ))}
            </Section>
          </View>
        ) : null}
        {suggestions.length > 0 ? (
          <View style={{ paddingHorizontal: 16, paddingTop: recipients.length ? 0 : 16 }}>
            <Section title={t("projectContacts")}>
              {suggestions.map((person, index) => {
                const selected = recipients.some((item) => item.contact?.userId === person.userId);
                return (
                  <View key={person.userId}>
                    {index > 0 ? <Separator inset={64} /> : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={person.displayName}
                      accessibilityState={{ selected, disabled: busy }}
                      disabled={busy}
                      onPress={() => toggleContact(person)}
                      style={({ pressed }) => ({
                        alignItems: "center",
                        backgroundColor: pressed ? colors.elevatedSurface : "transparent",
                        flexDirection: "row",
                        gap: 12,
                        minHeight: 56,
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                      })}
                    >
                      <PersonAvatar size={36} name={person.displayName} uri={person.photoUrl} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: colors.label, fontSize: 17 }}>
                          {person.displayName}
                        </Text>
                        {person.headline ? (
                          <Text
                            numberOfLines={1}
                            style={{ color: colors.secondaryLabel, fontSize: 14 }}
                          >
                            {person.headline}
                          </Text>
                        ) : null}
                      </View>
                      {selected ? (
                        <SymbolView
                          name="checkmark"
                          tintColor={colors.accent}
                          size={17}
                          weight="semibold"
                          accessible={false}
                        />
                      ) : null}
                    </Pressable>
                  </View>
                );
              })}
            </Section>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
