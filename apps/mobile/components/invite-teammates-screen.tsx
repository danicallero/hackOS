import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useLayoutEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { projectMutation } from "@/lib/projects";
import { colors } from "@/theme/colors";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Recipient {
  email: string;
  error?: Error;
}

function CircleButton({
  icon,
  label,
  onPress,
  disabled = false,
  prominent = false,
  filled = false,
  size = 44,
}: {
  icon: "xmark" | "checkmark" | "plus";
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** The confirm button turns accent blue once it can act, as in Photos. */
  prominent?: boolean;
  /** A quiet filled circle (the add button). */
  filled?: boolean;
  size?: number;
}) {
  const active = prominent && !disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={{
        alignItems: "center",
        backgroundColor: active ? colors.accent : filled ? colors.elevatedSurface : undefined,
        borderRadius: size / 2,
        height: size,
        justifyContent: "center",
        width: size,
      }}
    >
      <SymbolView
        name={icon}
        tintColor={
          active ? colors.primaryActionText : disabled ? colors.tertiaryLabel : colors.label
        }
        size={size > 36 ? 19 : 16}
        weight="semibold"
        accessible={false}
      />
    </Pressable>
  );
}

/**
 * H19: invite several teammates at once, like Photos' "Invite Participants":
 * round close and confirm in the header, an "Add:" field that turns each email
 * into a row, and the server's reason shown on the row that was refused.
 */
export function InviteTeammatesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const [draft, setDraft] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [busy, setBusy] = useState(false);
  const draftValid = EMAIL.test(draft.trim());
  function add() {
    const email = draft.trim();
    if (!EMAIL.test(email)) return;
    setRecipients((current) =>
      current.some((item) => item.email.toLowerCase() === email.toLowerCase())
        ? current
        : [...current, { email }],
    );
    setDraft("");
  }
  async function confirm() {
    const pending = [
      ...recipients.map((item) => item.email),
      ...(draftValid ? [draft.trim()] : []),
    ].filter((email, index, all) => all.indexOf(email) === index);
    if (pending.length === 0 || busy) return;
    setBusy(true);
    const failed: Recipient[] = [];
    for (const email of pending) {
      try {
        await projectMutation(`/api/me/projects/${id}/invites`, "POST", { email });
      } catch (cause) {
        failed.push({ email, error: cause as Error });
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
                <View key={recipient.email}>
                  {index > 0 ? <Separator /> : null}
                  <View style={{ gap: 6, paddingHorizontal: 16, paddingVertical: 10 }}>
                    <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
                      <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>
                        {recipient.email}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t("remove")} ${recipient.email}`}
                        hitSlop={10}
                        onPress={() =>
                          setRecipients((current) =>
                            current.filter((item) => item.email !== recipient.email),
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
      </ScrollView>
    </>
  );
}
