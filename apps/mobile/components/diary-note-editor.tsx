import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Text, TextInput, View } from "react-native";
import { AdaptiveFrame } from "@/components/adaptive-frame";
import { SheetModal } from "@/components/app-sheet";
import { FloatingGlassButton } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { colors, radius, type } from "@/theme";

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
  const [note, setNote] = useState("");
  useEffect(() => {
    if (visible) setNote(initialNote ?? "");
  }, [visible, initialNote]);
  return (
    <SheetModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <AdaptiveFrame>
        <View
          style={{
            alignItems: "center",
            height: HEADER_HEIGHT,
            justifyContent: "center",
            paddingHorizontal: 72,
          }}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
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
              borderRadius: radius.control,
              color: colors.label,
              flex: 1,
              fontSize: type.body.fontSize,
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
          onPress={() => onSave(note)}
        />
      </AdaptiveFrame>
    </SheetModal>
  );
}
