import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, Text, TextInput, View } from "react-native";
import { ActionButton, useDialogCardColors } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

const NOTE_MAX_LENGTH = 500;

/** The owner's private note on one diary entry, person or company (#935). */
export function DiaryNoteEditor({
  visible,
  initialNote,
  onClose,
  onSave,
}: {
  visible: boolean;
  initialNote: string | null;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const { t } = useLocale();
  const fill = useDialogCardColors();
  const [note, setNote] = useState("");
  useEffect(() => {
    if (visible) setNote(initialNote ?? "");
  }, [visible, initialNote]);
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel={t("close")}
        accessibilityRole="button"
        onPress={onClose}
        style={{ backgroundColor: "rgba(0,0,0,0.4)", position: "absolute", inset: 0 }}
      />
      {/* The card rises above the keyboard; centred under it, iOS hid
          Save and Cancel behind the keys (#935). */}
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
        style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}
      >
        <View
          accessibilityViewIsModal
          style={{
            alignSelf: "center",
            backgroundColor: fill.card,
            borderCurve: "continuous",
            borderRadius: 24,
            gap: 14,
            maxWidth: 420,
            padding: 20,
            width: "100%",
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: colors.label, fontSize: 18, fontWeight: "700" }}
          >
            {t("diaryNote")}
          </Text>
          <TextInput
            accessibilityLabel={t("diaryNote")}
            autoFocus
            multiline
            maxLength={NOTE_MAX_LENGTH}
            value={note}
            onChangeText={setNote}
            style={{
              backgroundColor: fill.field,
              borderCurve: "continuous",
              borderRadius: 12,
              color: colors.label,
              fontSize: 17,
              minHeight: 110,
              padding: 14,
              textAlignVertical: "top",
            }}
          />
          <ActionButton variant="filled" label={t("save")} onPress={() => onSave(note)} />
          <ActionButton label={t("cancel")} onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
