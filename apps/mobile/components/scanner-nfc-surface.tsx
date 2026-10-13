import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
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
  onOpenPeople,
  onManual,
  scanningEnabled,
  nfcActive = false,
  nfcStartLabel,
}: {
  onValue: (value: string) => void;
  onNfc?: () => void;
  onCamera: () => void;
  onOpenPeople?: () => void;
  onManual?: () => void;
  scanningEnabled: boolean;
  nfcActive?: boolean;
  nfcStartLabel?: string;
}) {
  const { t } = useLocale();
  const bottomInset = useRouterTabBarBottomInset();
  const focused = useIsFocused();
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const nfcLabel = nfcActive ? t("scannerNfcStop") : (nfcStartLabel ?? t("scannerNfcScan"));
  useEffect(() => {
    if (!focused || !scanningEnabled) setManualEntryVisible(false);
  }, [focused, scanningEnabled]);
  return (
    <View style={{ flex: 1, paddingHorizontal: 24, paddingBottom: bottomInset + 4 }}>
      <View
        style={{
          flex: 1,
          minHeight: 0,
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 24,
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
            tintColor={nfcActive ? colors.accent : colors.secondaryLabel}
            size={80}
            weight="regular"
          />
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: colors.secondaryLabel,
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
        {onOpenPeople ? (
          <ScannerActionButton
            label={t("scannerViewPeople")}
            icon="person.crop.badge.magnifyingglass"
            onPress={onOpenPeople}
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
      </View>
      <ScannerCodeEntry
        visible={manualEntryVisible}
        onClose={() => setManualEntryVisible(false)}
        onValue={onValue}
      />
    </View>
  );
}
