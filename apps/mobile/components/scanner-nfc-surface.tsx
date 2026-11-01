import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { useIsFocused } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { type LayoutChangeEvent, Pressable, Text, useWindowDimensions, View } from "react-native";
import { ScannerActionButton } from "@/components/scanner-action-button";
import { ScannerCodeEntry } from "@/components/scanner-code-entry";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarBottomInset } from "@/lib/router-tabs-inset";
import { colors } from "@/theme/colors";
import {
  type OperatorLayout,
  readerFit,
  surfaceFit,
  useOperatorLayout,
} from "@/theme/layout-screens";
import { type } from "@/theme/tokens";

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
  const { fontScale } = useWindowDimensions();
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const [columnWidth, setColumnWidth] = useState<number | null>(null);
  const [surfaceHeight, setSurfaceHeight] = useState<number | null>(null);
  const [readerHeight, setReaderHeight] = useState<number | null>(null);
  const baseLayout = useOperatorLayout(columnWidth);
  // The surface never scrolls: it fits the height it was given (a short pane included) by going
  // dense, and the reader area, which takes what the header and actions leave, shrinks last.
  const fit = surfaceFit(baseLayout, surfaceHeight, fontScale);
  const layout = { ...baseLayout, stats: fit.stats, actions: fit.actions };
  const reader = readerFit(readerHeight, fontScale);
  const nfcLabel = nfcActive ? t("scannerNfcStop") : (nfcStartLabel ?? t("scannerNfcScan"));
  useEffect(() => {
    if (!focused || !scanningEnabled) setManualEntryVisible(false);
  }, [focused, scanningEnabled]);
  const actionRow = layout.actions !== "column";
  const actionStyle = actionRow ? { flex: 1 } : undefined;
  const actionSize = layout.actions === "compact" ? "compact" : "large";
  const setHeight =
    (set: (update: (current: number | null) => number | null) => void) =>
    ({ nativeEvent }: LayoutChangeEvent) =>
      set((current) =>
        current === nativeEvent.layout.height ? current : nativeEvent.layout.height,
      );
  return (
    <>
      <View
        onLayout={setHeight(setSurfaceHeight)}
        testID="scanner-surface"
        style={{
          alignItems: "center",
          flex: 1,
          minHeight: 0,
          paddingBottom: bottomInset + 4,
          paddingHorizontal: layout.gutter,
        }}
      >
        <View
          onLayout={({ nativeEvent }) =>
            setColumnWidth((current) =>
              current === nativeEvent.layout.width ? current : nativeEvent.layout.width,
            )
          }
          style={{ flex: 1, maxWidth: layout.columnMaxWidth, minHeight: 0, width: "100%" }}
        >
          {header?.(layout)}
          <View
            onLayout={setHeight(setReaderHeight)}
            style={{
              alignItems: "center",
              flex: 1,
              gap: 16,
              justifyContent: "center",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {reader.symbolSize > 0 ? (
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
                  size={reader.symbolSize}
                  weight="regular"
                />
              </Pressable>
            ) : null}
            {reader.showCaption ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: colors.secondaryLabel,
                  fontSize: type.subhead.fontSize,
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
            ) : null}
          </View>
          <View style={{ flexDirection: actionRow ? "row" : "column", gap: 12 }}>
            {onOpenPeople ? (
              <View style={actionStyle}>
                <ScannerActionButton
                  size={actionSize}
                  label={t("scannerViewPeople")}
                  icon="person.crop.badge.magnifyingglass"
                  onPress={onOpenPeople}
                />
              </View>
            ) : null}
            <View style={actionStyle}>
              <ScannerActionButton
                size={actionSize}
                primary={!onNfc}
                label={t("scannerCamera")}
                icon="camera"
                disabled={!scanningEnabled}
                onPress={onCamera}
              />
            </View>
            <View style={actionStyle}>
              <ScannerActionButton
                size={actionSize}
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
      </View>
      <ScannerCodeEntry
        visible={manualEntryVisible}
        onClose={() => setManualEntryVisible(false)}
        onValue={onValue}
      />
    </>
  );
}
