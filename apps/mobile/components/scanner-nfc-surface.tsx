import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { useIsFocused } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ScannerActionButton } from "@/components/scanner-action-button";
import { ScannerCodeEntry } from "@/components/scanner-code-entry";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarBottomInset } from "@/lib/router-tabs-inset";
import { colors } from "@/theme/colors";
import { type OperatorLayout, useOperatorLayout } from "@/theme/layout-screens";

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
  header,
}: {
  onValue: (value: string) => void;
  onNfc?: () => void;
  onCamera: () => void;
  onOpenPeople?: () => void;
  onManual?: () => void;
  scanningEnabled: boolean;
  nfcActive?: boolean;
  nfcStartLabel?: string;
  /** Stats and notices above the reader; they scroll with it when the window is short. */
  header?: (layout: OperatorLayout) => ReactNode;
}) {
  const { t } = useLocale();
  const bottomInset = useRouterTabBarBottomInset();
  const focused = useIsFocused();
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const [columnWidth, setColumnWidth] = useState<number | null>(null);
  const layout = useOperatorLayout(columnWidth);
  const nfcLabel = nfcActive ? t("scannerNfcStop") : (nfcStartLabel ?? t("scannerNfcScan"));
  useEffect(() => {
    if (!focused || !scanningEnabled) setManualEntryVisible(false);
  }, [focused, scanningEnabled]);
  const actionStyle = layout.actions === "row" ? { flex: 1 } : undefined;
  return (
    <>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={{
          alignItems: "center",
          flexGrow: 1,
          paddingBottom: bottomInset + 4,
          paddingHorizontal: layout.gutter,
        }}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
      >
        <View
          onLayout={({ nativeEvent }) =>
            setColumnWidth((current) =>
              current === nativeEvent.layout.width ? current : nativeEvent.layout.width,
            )
          }
          style={{ flexGrow: 1, maxWidth: layout.columnMaxWidth, width: "100%" }}
        >
          {header?.(layout)}
          <View
            style={{
              alignItems: "center",
              flexGrow: 1,
              gap: 16,
              justifyContent: "center",
              minHeight: layout.shortWindow ? 112 : 168,
              paddingVertical: layout.shortWindow ? 12 : 24,
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
                size={layout.symbolSize}
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
          <View style={{ flexDirection: layout.actions === "row" ? "row" : "column", gap: 12 }}>
            {onOpenPeople ? (
              <View style={actionStyle}>
                <ScannerActionButton
                  label={t("scannerViewPeople")}
                  icon="person.crop.badge.magnifyingglass"
                  onPress={onOpenPeople}
                />
              </View>
            ) : null}
            <View style={actionStyle}>
              <ScannerActionButton
                primary={!onNfc}
                label={t("scannerCamera")}
                icon="camera"
                disabled={!scanningEnabled}
                onPress={onCamera}
              />
            </View>
            <View style={actionStyle}>
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
          </View>
        </View>
      </ScrollView>
      <ScannerCodeEntry
        visible={manualEntryVisible}
        onClose={() => setManualEntryVisible(false)}
        onValue={onValue}
      />
    </>
  );
}
