import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { GlassView } from "@/components/glass-view";
import { SymbolView } from "@/components/symbol";

import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { getBarcodeFrameObservation } from "@/lib/qr-frame";
import { advanceQrScanCandidate, type QrScanCandidate } from "@/lib/qr-scan-stability";
import { useRouterTabBarBottomInset } from "@/lib/router-tabs-inset";
import { scannerCameraControls } from "@/lib/scanner-camera-controls";
import CameraCapabilities from "@/modules/camera-capabilities";
import { colors } from "@/theme/colors";

export function QrCamera({
  onValue,
  onClose,
  hint,
  scanningEnabled = true,
}: {
  onValue: (value: string) => void;
  onClose?: () => void;
  hint?: string | null;
  scanningEnabled?: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const { t } = useLocale();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = useRouterTabBarBottomInset();
  const locked = useRef(false);
  const scanCandidate = useRef<QrScanCandidate | null>(null);
  const [{ height, width }, setViewport] = useState({ height: 0, width: 0 });
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [cameraControls] = useState(() => {
    try {
      return scannerCameraControls(CameraCapabilities?.hasBackCameraTorch() === true);
    } catch {
      return scannerCameraControls(false);
    }
  });
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const frameLeft = (width - FRAME) / 2;
  const frameTop = (height - FRAME) / 2;
  const frameRight = frameLeft + FRAME;
  const frameBottom = frameTop + FRAME;
  const shadePath = [
    `M0 0 H${width} V${height} H0 Z`,
    `M${frameLeft + FRAME_RADIUS} ${frameTop}`,
    `H${frameRight - FRAME_RADIUS}`,
    `A${FRAME_RADIUS} ${FRAME_RADIUS} 0 0 1 ${frameRight} ${frameTop + FRAME_RADIUS}`,
    `V${frameBottom - FRAME_RADIUS}`,
    `A${FRAME_RADIUS} ${FRAME_RADIUS} 0 0 1 ${frameRight - FRAME_RADIUS} ${frameBottom}`,
    `H${frameLeft + FRAME_RADIUS}`,
    `A${FRAME_RADIUS} ${FRAME_RADIUS} 0 0 1 ${frameLeft} ${frameBottom - FRAME_RADIUS}`,
    `V${frameTop + FRAME_RADIUS}`,
    `A${FRAME_RADIUS} ${FRAME_RADIUS} 0 0 1 ${frameLeft + FRAME_RADIUS} ${frameTop}`,
    "Z",
  ].join(" ");

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!isFocused) {
      locked.current = false;
      scanCandidate.current = null;
      setTorchEnabled(false);
      setManualEntryVisible(false);
      setManualCode("");
    }
  }, [isFocused]);

  useEffect(() => {
    scanCandidate.current = null;
    if (scanningEnabled) locked.current = false;
  }, [scanningEnabled]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const showSub = Keyboard.addListener("keyboardWillShow", (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  function submitManualEntry() {
    const value = manualCode.trim();
    if (!value) return;
    setManualEntryVisible(false);
    setManualCode("");
    onValue(value);
  }

  if (!permission) return <View style={styles.black} />;
  if (!permission.granted) {
    return (
      <View
        style={[
          styles.permission,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <SymbolView
          accessible={false}
          name="camera.fill"
          tintColor={colors.secondaryLabel}
          size={42}
        />
        <Text selectable style={styles.permissionTitle}>
          {t("scannerCameraAccess")}
        </Text>
        <Text selectable style={styles.permissionBody}>
          {t("scannerCameraPermissionBody")}
        </Text>
        {permission.canAskAgain ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void requestPermission()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{t("scannerAllowCamera")}</Text>
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{t("close")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View
      onLayout={({ nativeEvent }) => {
        const next = nativeEvent.layout;
        if (height !== next.height || width !== next.width) scanCandidate.current = null;
        setViewport((current) =>
          current.height === next.height && current.width === next.width
            ? current
            : { height: next.height, width: next.width },
        );
      }}
      style={styles.black}
    >
      {isFocused ? (
        <CameraView
          active={isFocused}
          // The preview only scans barcodes; it must never win hit-testing
          // over the controls rendered above it (toolbar, queue, flashlight,
          // and manual-entry buttons) on iOS 18's native camera surface.
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={cameraControls.showTorch && torchEnabled}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={
            scanningEnabled && !manualEntryVisible
              ? (result: BarcodeScanningResult) => {
                  if (locked.current) return;
                  const observation = getBarcodeFrameObservation(result, { height, width }, FRAME);
                  if (!observation) {
                    scanCandidate.current = null;
                    return;
                  }
                  const confirmation = advanceQrScanCandidate(
                    scanCandidate.current,
                    result.data,
                    observation,
                    Date.now(),
                  );
                  scanCandidate.current = confirmation.candidate;
                  if (!confirmation.accepted) return;
                  locked.current = true;
                  onValue(result.data);
                  setTimeout(() => {
                    locked.current = false;
                  }, 1200);
                }
              : undefined
          }
        />
      ) : null}
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Path d={shadePath} fill="rgba(0,0,0,0.54)" fillRule="evenodd" />
      </Svg>
      <View pointerEvents="none" style={styles.frameOverlay}>
        <View style={styles.frame}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>
      </View>
      {hint === null ? null : (
        <Text pointerEvents="none" style={[styles.hint, { top: height / 2 + FRAME / 2 + 24 }]}>
          {hint ?? t("scannerQrHint")}
        </Text>
      )}
      {cameraControls.showTorch ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          colorScheme="dark"
          style={[styles.cameraControl, { bottom: tabBarBottomInset + 4 }]}
        >
          <Pressable
            accessibilityLabel={
              torchEnabled ? t("scannerTurnOffFlashlight") : t("scannerTurnOnFlashlight")
            }
            accessibilityRole="button"
            accessibilityState={{ selected: torchEnabled }}
            onPress={() => {
              void haptic("selection");
              setTorchEnabled((current) => !current);
            }}
            style={styles.cameraControlPressable}
          >
            <SymbolView
              name={torchEnabled ? "flashlight.on.fill" : "flashlight.off.fill"}
              tintColor="white"
              size={23}
              weight="semibold"
            />
          </Pressable>
        </GlassView>
      ) : null}
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        colorScheme="dark"
        style={[
          styles.cameraControl,
          cameraControls.manualEntrySide === "left" && styles.cameraControlLeft,
          { bottom: tabBarBottomInset + 4 },
        ]}
      >
        <Pressable
          accessibilityLabel={t("scannerEnterManually")}
          accessibilityRole="button"
          onPress={() => {
            void haptic("light");
            scanCandidate.current = null;
            setManualEntryVisible(true);
          }}
          style={styles.cameraControlPressable}
        >
          <SymbolView name="keyboard" tintColor="white" size={23} weight="semibold" />
        </Pressable>
      </GlassView>
      {onClose ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          colorScheme="dark"
          style={[styles.backControl, { top: insets.top + 12 }]}
        >
          <Pressable
            accessibilityLabel={t("back")}
            accessibilityRole="button"
            onPress={onClose}
            style={styles.cameraControlPressable}
          >
            <SymbolView name="chevron.left" tintColor="white" size={19} weight="semibold" />
          </Pressable>
        </GlassView>
      ) : null}
      <Modal
        animationType="fade"
        transparent
        visible={manualEntryVisible}
        onRequestClose={() => setManualEntryVisible(false)}
      >
        <Pressable
          accessibilityLabel={t("close")}
          accessibilityRole="button"
          onPress={() => setManualEntryVisible(false)}
          style={styles.manualEntryBackdrop}
        />
        <View
          pointerEvents="box-none"
          style={[
            styles.manualEntryWrapper,
            {
              bottom: keyboardHeight > 0 ? keyboardHeight + 40 : tabBarBottomInset + 40,
            },
          ]}
        >
          <GlassView colorScheme="dark" glassEffectStyle="regular" style={styles.manualEntrySheet}>
            <Text selectable style={styles.manualEntryTitle}>
              {t("scannerManualEntryTitle")}
            </Text>
            <TextInput
              accessibilityLabel={t("scannerManualEntryTitle")}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              onChangeText={setManualCode}
              onSubmitEditing={submitManualEntry}
              placeholder={t("scannerManualEntryPlaceholder")}
              placeholderTextColor="rgba(255,255,255,0.5)"
              returnKeyType="done"
              style={styles.manualEntryInput}
              value={manualCode}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !manualCode.trim() }}
              disabled={!manualCode.trim()}
              onPress={submitManualEntry}
              style={[styles.primaryButton, !manualCode.trim() && styles.primaryButtonDisabled]}
            >
              <Text style={styles.primaryButtonText}>{t("scannerManualEntrySubmit")}</Text>
            </Pressable>
          </GlassView>
        </View>
      </Modal>
    </View>
  );
}

const FRAME = 264;
const FRAME_RADIUS = 28;
const styles = StyleSheet.create({
  black: { backgroundColor: "#000", flex: 1 },
  frameOverlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  frame: { borderRadius: FRAME_RADIUS, height: FRAME, overflow: "hidden", width: FRAME },
  corner: { borderColor: "white", height: 52, position: "absolute", width: 52 },
  topLeft: {
    borderLeftWidth: 4,
    borderTopLeftRadius: FRAME_RADIUS,
    borderTopWidth: 4,
    left: 0,
    top: 0,
  },
  topRight: {
    borderRightWidth: 4,
    borderTopRightRadius: FRAME_RADIUS,
    borderTopWidth: 4,
    right: 0,
    top: 0,
  },
  bottomLeft: {
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    bottom: 0,
    left: 0,
    borderBottomLeftRadius: FRAME_RADIUS,
  },
  bottomRight: {
    borderBottomWidth: 4,
    borderRightWidth: 4,
    bottom: 0,
    right: 0,
    borderBottomRightRadius: FRAME_RADIUS,
  },
  hint: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    left: 28,
    position: "absolute",
    right: 28,
    textAlign: "center",
  },
  cameraControl: {
    borderRadius: 30,
    height: 60,
    position: "absolute",
    right: 22,
    zIndex: 20,
    width: 60,
  },
  cameraControlLeft: { left: 22, right: undefined },
  backControl: {
    borderRadius: 22,
    height: 44,
    left: 16,
    position: "absolute",
    zIndex: 20,
    width: 44,
  },
  cameraControlPressable: {
    alignItems: "center",
    borderRadius: 999,
    flex: 1,
    justifyContent: "center",
  },
  permission: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: 14,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  permissionTitle: { color: colors.label, fontSize: 22, fontWeight: "700" },
  permissionBody: {
    color: colors.secondaryLabel,
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderCurve: "continuous",
    borderRadius: 14,
    marginTop: 8,
    minWidth: 200,
    padding: 14,
  },
  primaryButtonText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  primaryButtonDisabled: { opacity: 0.45 },
  secondaryButton: { padding: 12 },
  secondaryButtonText: { color: colors.accent, fontSize: 16, fontWeight: "600" },
  manualEntryBackdrop: {
    backgroundColor: "rgba(0,0,0,0.4)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  manualEntryWrapper: {
    alignItems: "center",
    left: 0,
    paddingHorizontal: 20,
    position: "absolute",
    right: 0,
  },
  manualEntrySheet: {
    borderCurve: "continuous",
    borderRadius: 28,
    gap: 14,
    maxWidth: 390,
    overflow: "hidden",
    padding: 20,
    width: "100%",
  },
  manualEntryTitle: { color: "white", fontSize: 18, fontWeight: "700" },
  manualEntryInput: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderCurve: "continuous",
    borderRadius: 12,
    color: "white",
    fontSize: 17,
    padding: 14,
  },
});
