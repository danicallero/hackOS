import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { projectMutation } from "@/lib/projects";
import { colors } from "@/theme/colors";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * H19: invite a teammate in place. The row opens into an email field with a
 * round send button; the screen stays mounted, the reason for a refusal shows
 * right under the field, and the team list refreshes on success.
 */
export function InviteTeammateRow({
  projectId,
  disabled,
  onInvited,
}: {
  projectId: number;
  disabled: boolean;
  onInvited: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const valid = EMAIL.test(email.trim());
  async function send() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await projectMutation(`/api/me/projects/${projectId}/invites`, "POST", {
        email: email.trim(),
      });
      void haptic("success");
      setEmail("");
      setOpen(false);
      onInvited();
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("projectInvite")}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: 12,
          minHeight: 50,
          opacity: disabled ? 0.5 : 1,
          paddingHorizontal: 16,
        }}
      >
        <SymbolView
          name="person.badge.plus"
          tintColor={colors.accent}
          size={22}
          accessible={false}
        />
        <Text style={{ color: colors.accent, flex: 1, fontSize: 17 }}>{t("projectInvite")}</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
        <SymbolView
          name="envelope"
          tintColor={colors.secondaryLabel}
          size={20}
          accessible={false}
        />
        <TextInput
          accessibilityLabel={t("projectEmail")}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          autoFocus
          editable={!busy}
          keyboardType="email-address"
          onChangeText={(next) => {
            setEmail(next);
            setError(null);
          }}
          onSubmitEditing={() => void send()}
          placeholder={t("projectEmail")}
          placeholderTextColor={colors.tertiaryLabel}
          returnKeyType="send"
          style={{ color: colors.label, flex: 1, fontSize: 17, minHeight: 44, padding: 0 }}
          textContentType="emailAddress"
          value={email}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("projectSend")}
          accessibilityState={{ disabled: !valid || busy, busy }}
          disabled={!valid || busy}
          onPress={() => void send()}
          style={{
            alignItems: "center",
            backgroundColor: colors.accent,
            borderRadius: 22,
            height: 44,
            justifyContent: "center",
            opacity: !valid || busy ? 0.35 : 1,
            width: 44,
          }}
        >
          <SymbolView
            name="arrow.up"
            tintColor={colors.primaryActionText}
            size={18}
            weight="bold"
            accessible={false}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("cancel")}
          onPress={() => {
            setOpen(false);
            setEmail("");
            setError(null);
          }}
          style={{ alignItems: "center", height: 44, justifyContent: "center", width: 32 }}
        >
          <SymbolView
            name="xmark"
            tintColor={colors.tertiaryLabel}
            size={15}
            weight="semibold"
            accessible={false}
          />
        </Pressable>
      </View>
      {error ? <RequestFeedback error={error} /> : null}
    </View>
  );
}
