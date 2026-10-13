import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScannerActionButton } from "@/components/scanner-action-button";
import { ScannerCodeEntry } from "@/components/scanner-code-entry";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarBottomInset } from "@/lib/router-tabs-inset";
import { colors } from "@/theme/colors";

// H22–H26: both operational readers share capture geometry and input alternatives.
export function NfcScannerSurface({
  onValue,
  onNfc,
  onCamera,
  onManual,
  onClose,
  scanningEnabled,
  nfcActive = false,
  nfcStartLabel,
}: {
  onValue: (value: string) => void;
  onNfc?: () => void;
  onCamera: () => void;
  onManual?: () => void;
  onClose?: () => void;
  scanningEnabled: boolean;
  nfcActive?: boolean;
  nfcStartLabel?: string;
}) {
  const { t } = useLocale();
  const bottomInset = useRouterTabBarBottomInset();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const nfcLabel = nfcActive ? t("scannerNfcStop") : (nfcStartLabel ?? t("scannerNfcScan"));
  useEffect(() => {
    if (!focused || !scanningEnabled) setManualEntryVisible(false);
  }, [focused, scanningEnabled]);
  return (
    <View
      style={{ flex: 1, paddingHorizontal: 24, paddingBottom: bottomInset + insets.bottom + 20 }}
    >
      <View
        style={{
          flex: 1,
          minHeight: 184,
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 32,
          gap: 16,
        }}
      >
        <Pressable
          accessible={Boolean(onNfc)}
          accessibilityRole={onNfc ? "button" : undefined}
          accessibilityLabel={onNfc ? nfcLabel : undefined}
          accessibilityState={{ disabled: !onNfc || !scanningEnabled, selected: nfcActive }}
          testID="scanner-nfc-toggle"
          disabled={!onNfc || !scanningEnabled}
          onPress={onNfc}
          style={({ pressed }) => ({ padding: 12, opacity: pressed ? 0.6 : 1 })}
        >
          <SymbolView
            accessible={false}
            name="wave.3.right"
            tintColor={nfcActive ? colors.accent : "rgba(255,255,255,0.55)"}
            size={80}
            weight="regular"
          />
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: "rgba(255,255,255,0.72)",
            fontSize: 15,
            textAlign: "center",
            maxWidth: 280,
          }}
        >
          {!onNfc
            ? t("scannerNfcUnavailable")
            : nfcActive
              ? t("scannerNfcActive")
              : t("scannerNfcIdle")}
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        {onNfc && Platform.OS !== "android" ? (
          <ScannerActionButton
            primary
            label={nfcLabel}
            icon="wave.3.right"
            disabled={!scanningEnabled}
            onPress={onNfc}
          />
        ) : null}
        <ScannerActionButton
          primary={!onNfc}
          label={t("scannerCamera")}
          icon="camera"
          disabled={!scanningEnabled}
          onPress={onCamera}
        />
        <ScannerActionButton
          testID={UI_TEST_IDS.scanner.manualEntry}
          label={t("scannerEnterManually")}
          icon="keyboard"
          disabled={!scanningEnabled}
          onPress={() => {
            onManual?.();
            setManualEntryVisible(true);
          }}
        />
        {onClose ? <ScannerActionButton label={t("close")} icon="xmark" onPress={onClose} /> : null}
      </View>
      <ScannerCodeEntry
        visible={manualEntryVisible}
        onClose={() => setManualEntryVisible(false)}
        onValue={onValue}
      />
    </View>
  );
}
