import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { View } from "react-native";
import { MenuView } from "@/components/app-menu";
import { GlassView } from "@/components/glass-view";
import { ActionButton, MenuTriggerIcon } from "@/components/native-ui";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useNfcSupported } from "@/lib/use-nfc-supported";
import { colors } from "@/theme/colors";

export interface ScanActionLabels {
  nfc: MessageKey;
  qr: MessageKey;
  manual: MessageKey;
  options: MessageKey;
}

const BADGE_LABELS: ScanActionLabels = {
  nfc: "personLinkBadgeNfc",
  qr: "personScanBadgeCode",
  manual: "personEnterBadgeCode",
  options: "personBadgeOptions",
};

/**
 * R008: NFC is the direct primary action where the hardware supports it; QR
 * and manual entry stay in a compact native menu. Without NFC, QR becomes the
 * primary action. Shared by badge linking (H22/H23) and the event diary (#935).
 */
export function BadgeLinkActions({
  onNfc,
  onAlternative,
  disabled,
  labels = BADGE_LABELS,
  testID = UI_TEST_IDS.scanner.linkBadge,
}: {
  onNfc: () => void;
  onAlternative: (method: "manual" | "qr") => void;
  disabled: boolean;
  labels?: ScanActionLabels;
  testID?: string;
}) {
  const { t } = useLocale();
  const nfcSupported = useNfcSupported();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <GlassView
        isInteractive={!disabled}
        glassEffectStyle="regular"
        tintColor={colors.primaryAction}
        style={{ flex: 1, borderRadius: 25, overflow: "hidden" }}
      >
        <ActionButton
          testID={testID}
          icon={nfcSupported ? "wave.3.right" : "qrcode.viewfinder"}
          label={t(nfcSupported ? labels.nfc : labels.qr)}
          variant="filled"
          style={{ borderRadius: 25, backgroundColor: "transparent" }}
          disabled={disabled}
          onPress={nfcSupported ? onNfc : () => onAlternative("qr")}
        />
      </GlassView>
      <MenuView
        shouldOpenOnLongPress={false}
        actions={[
          {
            id: "qr",
            title: t(labels.qr),
            image: "qrcode.viewfinder",
            attributes: { disabled },
          },
          {
            id: "manual",
            title: t(labels.manual),
            image: "keyboard",
            attributes: { disabled },
          },
        ]}
        onPressAction={({ nativeEvent }) => {
          if (!disabled && (nativeEvent.event === "manual" || nativeEvent.event === "qr"))
            onAlternative(nativeEvent.event);
        }}
      >
        <GlassView
          isInteractive={!disabled}
          glassEffectStyle="regular"
          style={{ width: 50, height: 50, borderRadius: 25, overflow: "hidden" }}
        >
          <MenuTriggerIcon
            icon="ellipsis"
            accessibilityLabel={t(labels.options)}
            tintColor={colors.accent}
            disabled={disabled}
            size={50}
            iconSize={20}
            weight="regular"
          />
        </GlassView>
      </MenuView>
    </View>
  );
}
