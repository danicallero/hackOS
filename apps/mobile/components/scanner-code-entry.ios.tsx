import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useLocale } from "@/lib/i18n";

/**
 * H22–H26: manual code entry as UIKit's own text-field alert, the same prompt
 * Settings and Wallet use. Camera, diary, badge assignment and replacement all
 * share it (#935). Alert text fields cannot be capitalised or disabled, so the
 * value is upper-cased and an empty one is ignored on submit.
 */
export function ScannerCodeEntry({
  visible,
  onValue,
  onClose,
  submitLabel,
  title,
  placeholder,
}: {
  visible: boolean;
  onValue: (value: string) => void;
  onClose: () => void;
  submitLabel?: string;
  /** Defaults to the badge wording; the diary also accepts stand codes. */
  title?: string;
  /** Shown under the title when the title alone does not name the field. */
  placeholder?: string | null;
}) {
  const { t } = useLocale();
  const latest = useRef({ onValue, onClose });
  latest.current = { onValue, onClose };
  const heading = title ?? t("scannerManualEntryTitle");
  const confirm = submitLabel ?? t("scannerRegister");
  const cancel = t("cancel");

  useEffect(() => {
    if (!visible) return;
    Alert.prompt(
      heading,
      placeholder ?? undefined,
      [
        { text: cancel, style: "cancel", onPress: () => latest.current.onClose() },
        {
          text: confirm,
          isPreferred: true,
          onPress: (value?: string) => {
            const code = value?.trim().toUpperCase();
            if (code) latest.current.onValue(code);
            latest.current.onClose();
          },
        },
      ],
      "plain-text",
    );
  }, [visible, heading, confirm, cancel, placeholder]);

  return null;
}
