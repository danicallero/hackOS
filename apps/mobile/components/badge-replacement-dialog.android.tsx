import { AlertDialog, Button, Column, Host, Text, TextButton } from "@expo/ui/jetpack-compose";
import { defaultMinSize, fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { useLocale } from "@/lib/i18n";
import { useNfcSupported } from "@/lib/use-nfc-supported";

// H22–H26: native Material presentation with an explicit primary NFC action.
export function BadgeReplacementDialog({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (method: "qr" | "nfc") => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const nfcSupported = useNfcSupported();
  if (!visible) return null;
  return (
    <Host style={{ position: "absolute", width: 0, height: 0 }}>
      <AlertDialog onDismissRequest={onClose}>
        <AlertDialog.Title>
          <Text style={{ typography: "headlineSmall" }}>{t("personReplaceBadge")}</Text>
        </AlertDialog.Title>
        <AlertDialog.Text>
          <Text>{t("personReplaceBadgeMethod")}</Text>
        </AlertDialog.Text>
        <AlertDialog.ConfirmButton>
          <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 8 }}>
            <TextButton
              modifiers={[fillMaxWidth(), defaultMinSize({ minHeight: 48 })]}
              onClick={() => onSelect("qr")}
            >
              <Text>{t("personScanBadgeCode")}</Text>
            </TextButton>
            {nfcSupported ? (
              <Button
                modifiers={[fillMaxWidth(), defaultMinSize({ minHeight: 48 })]}
                onClick={() => onSelect("nfc")}
              >
                <Text>{t("scannerNfcScan")}</Text>
              </Button>
            ) : null}
            <TextButton
              modifiers={[fillMaxWidth(), defaultMinSize({ minHeight: 48 })]}
              onClick={onClose}
            >
              <Text>{t("cancel")}</Text>
            </TextButton>
          </Column>
        </AlertDialog.ConfirmButton>
      </AlertDialog>
    </Host>
  );
}
