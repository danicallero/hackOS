import { useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Section } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { projectMutation } from "@/lib/projects";
import { colors } from "@/theme/colors";

const NAME_MAX = 80;

function BarButton({
  label,
  onPress,
  disabled = false,
  bold = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  bold?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 4 }}
    >
      <Text
        style={{
          color: colors.accent,
          fontSize: 17,
          fontWeight: bold ? "600" : "400",
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** H19: a modal sheet with the Cancel / Create pattern; the name field is focused on open. */
export function NewProjectScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const [name, setName] = useState("");
  const [canCreate, setCanCreate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    void apiFetch<{ canCreate: boolean }>("/api/me/projects")
      .then((result) => setCanCreate(result.canCreate))
      .catch(() => {});
  }, []);
  const valid = name.trim().length > 0 && canCreate && !busy;
  async function create() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await projectMutation<{ id: number }>("/api/me/projects", "POST", {
        name: name.trim(),
      });
      void haptic("success");
      // H19: replace the sheet atomically; back then push races the native dismissal.
      router.replace(`/projects/${created.id}`);
    } catch (cause) {
      setError(cause as Error);
      setBusy(false);
    }
  }
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <BarButton label={t("cancel")} onPress={() => router.back()} />,
      headerRight: () => (
        <BarButton
          label={t("projectCreate")}
          bold
          disabled={!valid}
          onPress={() => void create()}
        />
      ),
    });
  });
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 16, padding: 16 }}
      style={{ backgroundColor: colors.background }}
    >
      <Section footer={!canCreate ? t("projectLocked") : undefined}>
        <View style={{ minHeight: 56, justifyContent: "center", paddingHorizontal: 16 }}>
          <TextInput
            accessibilityLabel={t("projectName")}
            autoFocus
            editable={!busy && canCreate}
            maxLength={NAME_MAX}
            onChangeText={setName}
            onSubmitEditing={() => void create()}
            placeholder={t("projectName")}
            placeholderTextColor={colors.tertiaryLabel}
            returnKeyType="done"
            style={{ color: colors.label, fontSize: 17, minHeight: 44, padding: 0 }}
            value={name}
          />
        </View>
      </Section>
      {error ? <RequestFeedback error={error} /> : null}
    </ScrollView>
  );
}
