import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
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

import { useLocale } from "@/lib/i18n";
import { getBarcodeFrameObservation } from "@/lib/qr-frame";
import { advanceQrScanCandidate, type QrScanCandidate } from "@/lib/qr-scan-stability";
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
        <SymbolView name="camera.fill" tintColor={colors.secondaryLabel} size={42} />
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
          style={[styles.cameraControl, { bottom: insets.bottom + 26 }]}
        >
          <Pressable
            accessibilityLabel={
              torchEnabled ? t("scannerTurnOffFlashlight") : t("scannerTurnOnFlashlight")
            }
            accessibilityRole="button"
            accessibilityState={{ selected: torchEnabled }}
            onPress={() => setTorchEnabled((current) => !current)}
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
          { bottom: insets.bottom + 26 },
        ]}
      >
        <Pressable
          accessibilityLabel={t("scannerEnterManually")}
          accessibilityRole="button"
          onPress={() => {
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
        animationType="slide"
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
          style={styles.manualEntryWrapper}
        >
          <View style={[styles.manualEntrySheet, { paddingBottom: insets.bottom + 20 }]}>
            <Text selectable style={styles.manualEntryTitle}>
              {t("scannerManualEntryTitle")}
            </Text>
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              onChangeText={setManualCode}
              onSubmitEditing={submitManualEntry}
              placeholder={t("scannerManualEntryPlaceholder")}
              placeholderTextColor={colors.secondaryLabel}
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
          </View>
        </KeyboardAvoidingView>
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
    width: 60,
  },
  cameraControlLeft: { left: 22, right: undefined },
  backControl: {
    borderRadius: 22,
    height: 44,
    left: 16,
    position: "absolute",
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
  manualEntryWrapper: { flex: 1, justifyContent: "flex-end" },
  manualEntrySheet: {
    backgroundColor: colors.background,
    borderCurve: "continuous",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  manualEntryTitle: { color: colors.label, fontSize: 18, fontWeight: "700" },
  manualEntryInput: {
    backgroundColor: colors.surface,
    borderCurve: "continuous",
    borderRadius: 12,
    color: colors.label,
    fontSize: 17,
    padding: 14,
  },
});
