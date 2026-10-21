import { useEffect, useRef } from "react";
import { alert } from "@/lib/alert";
import { useLocale } from "@/lib/i18n";
import { useNfcSupported } from "@/lib/use-nfc-supported";

// H22–H26: Android draws the same stacked iOS action sheet-style alert as every
// other confirmation (lib/alert.ts + AlertHost) instead of a Material dialog.
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
  // The alert callbacks outlive this render; keep the latest handlers.
  const latest = useRef({ onSelect, onClose, t, nfcSupported });
  latest.current = { onSelect, onClose, t, nfcSupported };

  useEffect(() => {
    if (!visible) return;
    const { t, nfcSupported } = latest.current;
    alert(
      t("personReplaceBadge"),
      t("personReplaceBadgeMethod"),
      [
        ...(nfcSupported
          ? [{ text: t("scannerNfcScan"), onPress: () => latest.current.onSelect("nfc") }]
          : []),
        { text: t("personScanBadgeCode"), onPress: () => latest.current.onSelect("qr") },
        { text: t("cancel"), style: "cancel" as const, onPress: () => latest.current.onClose() },
      ],
      { cancelable: true, onDismiss: () => latest.current.onClose() },
    );
  }, [visible]);

  return null;
}
