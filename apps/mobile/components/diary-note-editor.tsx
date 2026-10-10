import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingGlassButton } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

const NOTE_MAX_LENGTH = 500;
const HEADER_HEIGHT = 76;

/**
 * The owner's private note on one diary entry, person or company (#935).
 *
 * A native page sheet rather than a hand-made centred card: the card had to
 * be re-centred above every keyboard (iOS hid Save behind the keys; Android,
 * edge-to-edge, never resized the modal). The sheet keeps a fixed header,
 * circular Cancel and Save in the corners as in the CV viewer and team
 * sheets, and a field that fills the space the keyboard leaves.
 */
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
  const insets = useSafeAreaInsets();
  // A pageSheet on iOS starts below the status bar; on Android the same
  // Modal is full screen, so its chrome clears the status bar itself.
  const sheetTopInset = process.env.EXPO_OS === "android" ? insets.top : 0;
  const [note, setNote] = useState("");
  useEffect(() => {
    if (visible) setNote(initialNote ?? "");
  }, [visible, initialNote]);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        <View
          style={{
            alignItems: "center",
            height: HEADER_HEIGHT + sheetTopInset,
            justifyContent: "center",
            paddingHorizontal: 72,
            paddingTop: sheetTopInset,
          }}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}
          >
            {t("diaryNote")}
          </Text>
        </View>
        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={process.env.EXPO_OS === "ios" ? HEADER_HEIGHT : 0}
          style={{ flex: 1, paddingBottom: 16, paddingHorizontal: 16 }}
        >
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
              flex: 1,
              fontSize: 17,
              lineHeight: 23,
              maxHeight: 320,
              paddingHorizontal: 16,
              paddingBottom: 14,
              paddingTop: 14,
              textAlignVertical: "top",
            }}
          />
        </KeyboardAvoidingView>
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
          onPress={() => onSave(note)}
        />
      </View>
    </Modal>
  );
}
