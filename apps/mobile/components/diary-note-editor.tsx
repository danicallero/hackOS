import { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { ActionButton } from "@/components/native-ui";
import type { DiaryEntry } from "@/lib/diary";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

const NOTE_MAX_LENGTH = 500;

/** The owner's private note on one diary entry (#935). */
export function DiaryNoteEditor({
  entry,
  onClose,
  onSave,
}: {
  entry: DiaryEntry | null;
  onClose: () => void;
  onSave: (entry: DiaryEntry, note: string) => void;
}) {
  const { t } = useLocale();
  const [note, setNote] = useState("");
  useEffect(() => {
    setNote(entry?.note ?? "");
  }, [entry]);
  return (
    <Modal transparent visible={entry !== null} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel={t("close")}
        accessibilityRole="button"
        onPress={onClose}
        style={{ backgroundColor: "rgba(0,0,0,0.4)", position: "absolute", inset: 0 }}
      />
      <View
        pointerEvents="box-none"
        style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}
      >
        <View
          accessibilityViewIsModal
          style={{
            alignSelf: "center",
            backgroundColor: colors.background,
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
              backgroundColor: colors.surface,
              borderCurve: "continuous",
              borderRadius: 12,
              color: colors.label,
              fontSize: 17,
              minHeight: 110,
              padding: 14,
              textAlignVertical: "top",
            }}
          />
          <ActionButton
            variant="filled"
            label={t("save")}
            onPress={() => {
              if (entry) onSave(entry, note);
            }}
          />
          <ActionButton label={t("cancel")} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
