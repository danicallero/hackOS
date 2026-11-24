import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused } from "expo-router";
import { type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { GlassView } from "@/components/glass-view";
import { NfcReader } from "@/components/nfc-reader";
import { QrCameraClosing, QrCameraModal } from "@/components/qr-camera-modal";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ScannerCodeEntry } from "@/components/scanner-code-entry";
import { NfcScannerSurface } from "@/components/scanner-nfc-surface";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { getBarcodeFrameObservation } from "@/lib/qr-frame";
import { advanceQrScanCandidate, type QrScanCandidate } from "@/lib/qr-scan-stability";
import { useRouterTabBarBottomInset } from "@/lib/router-tabs-inset";
import { scannerCameraControls } from "@/lib/scanner-camera-controls";
import { useSideRegion } from "@/lib/side-region";
import { useNfcSupportStatus } from "@/lib/use-nfc-supported";
import CameraCapabilities from "@/modules/camera-capabilities";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/dynamic-type";
import { type OperatorLayout, scanFrameSize } from "@/theme/layout-screens";
import { radius, type } from "@/theme/tokens";

export function QrCamera({
  onValue,
  onClose,
  hint,
  scanningEnabled = true,
  autoStartNfc = false,
  nfcSessionKey = 0,
  requestCameraOnFocus = true,
  nfcFirst = false,
  hideNfc = false,
  onOpenPeople,
  surfaceHeader,
}: {
  onValue: (value: string) => void;
  onClose?: () => void;
  hint?: string | null;
  scanningEnabled?: boolean;
  autoStartNfc?: boolean;
  nfcSessionKey?: number;
  requestCameraOnFocus?: boolean;
  nfcFirst?: boolean;
  hideNfc?: boolean;
  onOpenPeople?: () => void;
  /** Stats and notices shown above the NFC-first surface (they scroll with it). */
  surfaceHeader?: (layout: OperatorLayout) => ReactNode;
}) {
  const shouldAutoStartNfc = autoStartNfc || (nfcFirst && Platform.OS === "android");
  const nfcSupportStatus = useNfcSupportStatus();
  const nfcSupported = !hideNfc && nfcSupportStatus === "supported";
  const [nfcVisible, setNfcVisible] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const autoStarted = useRef(false);
  const lastNfcSessionKey = useRef(0);
  const focused = useIsFocused();
  const nfcSessionPending =
    focused &&
    scanningEnabled &&
    !hideNfc &&
    nfcSupportStatus !== "unsupported" &&
    ((shouldAutoStartNfc && !autoStarted.current) || nfcSessionKey !== lastNfcSessionKey.current);
  useEffect(() => {
    if (
      nfcSupported &&
      focused &&
      scanningEnabled &&
      ((shouldAutoStartNfc && !autoStarted.current) || nfcSessionKey !== lastNfcSessionKey.current)
    ) {
      autoStarted.current = true;
      lastNfcSessionKey.current = nfcSessionKey;
      setNfcVisible(true);
      if (nfcFirst) setCameraVisible(false);
    }
    if (!focused) {
      if (nfcFirst && Platform.OS === "android") autoStarted.current = false;
      setNfcVisible(false);
      setCameraVisible(false);
    }
  }, [focused, shouldAutoStartNfc, scanningEnabled, nfcSessionKey, nfcSupported, nfcFirst]);
  const openNfc = nfcSupported
    ? () => {
        if (nfcFirst) setCameraVisible(false);
        setNfcVisible((visible) => !visible);
      }
    : undefined;
  return (
    <>
      {nfcFirst ? (
        <NfcScannerSurface
          header={surfaceHeader}
          onOpenPeople={onOpenPeople}
          onValue={onValue}
          onNfc={openNfc}
          onCamera={() => {
            setNfcVisible(false);
            setCameraVisible(true);
          }}
          onManual={() => setNfcVisible(false)}
          nfcActive={nfcVisible && focused && scanningEnabled}
          scanningEnabled={scanningEnabled}
        />
      ) : (
        <CameraPreview
          onValue={onValue}
          onClose={onClose}
          hint={hint}
          scanningEnabled={scanningEnabled && !nfcVisible}
          nfcSessionPending={nfcSessionPending}
          requestCameraOnFocus={requestCameraOnFocus}
          onNfc={openNfc}
        />
      )}
      {nfcFirst ? (
        <QrCameraModal visible={cameraVisible} onClose={() => setCameraVisible(false)}>
          <CameraPreview
            onValue={(value) => {
              setCameraVisible(false);
              onValue(value);
            }}
            onClose={() => setCameraVisible(false)}
            hint={hint}
            scanningEnabled={scanningEnabled}
            nfcSessionPending={false}
            requestCameraOnFocus
          />
        </QrCameraModal>
      ) : null}
      <NfcReader
        visible={nfcSupported && nfcVisible && scanningEnabled}
        showAndroidOverlay={!nfcFirst}
        continuous={nfcFirst && Platform.OS === "android"}
        onValue={onValue}
        onClose={() => setNfcVisible(false)}
      />
    </>
  );
}

function CameraPreview({
  onValue,
  onClose,
  hint,
  scanningEnabled = true,
  onNfc,
  nfcSessionPending,
  requestCameraOnFocus,
}: {
  onNfc?: () => void;
  onValue: (value: string) => void;
  onClose?: () => void;
  hint?: string | null;
  scanningEnabled?: boolean;
  nfcSessionPending: boolean;
  requestCameraOnFocus: boolean;
}) {
  const closing = useContext(QrCameraClosing);
  const [permission, requestPermission] = useCameraPermissions();
  const { t } = useLocale();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const sideRegion = useSideRegion();
  const tabBarBottomInset = useRouterTabBarBottomInset();
  const locked = useRef(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();
  const idleScale = useSharedValue(1);
  useEffect(
    () => () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    },
    [],
  );
  const permissionRequestStarted = useRef(false);
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
  const [permissionError, setPermissionError] = useState<Error | null>(null);
  const pulseWhileScanning =
    isFocused && scanningEnabled && !closing && !manualEntryVisible && permission?.granted;
  useEffect(() => {
    if (!pulseWhileScanning || reducedMotion) {
      idleScale.value = 1;
      return;
    }
    idleScale.value = withRepeat(
      withTiming(1.012, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(idleScale);
  }, [idleScale, pulseWhileScanning, reducedMotion]);
  const requestCamera = useCallback(() => {
    permissionRequestStarted.current = true;
    setPermissionError(null);
    void Promise.resolve(requestPermission()).catch((cause) => {
      permissionRequestStarted.current = false;
      setPermissionError(cause instanceof Error ? cause : new Error(String(cause)));
    });
  }, [requestPermission]);
  const frameSize = scanFrameSize(width, height);
  // Use the same edge for the cutout and the corner strokes throughout the pulse.
  const frame = useDerivedValue(() => {
    const frameScale = idleScale.value;
    const size = frameSize * frameScale;
    const left = (width - size) / 2;
    const top = (height - size) / 2;
    const right = left + size;
    const bottom = top + size;
    const radius = FRAME_RADIUS * frameScale;
    const leg = 52 * frameScale;
    const arc = `A${radius} ${radius} 0 0 1`;
    const topLeft = `${arc} ${left + radius} ${top}`;
    const topRight = `${arc} ${right} ${top + radius}`;
    const bottomRight = `${arc} ${right - radius} ${bottom}`;
    const bottomLeft = `${arc} ${left} ${bottom - radius}`;

    return {
      outline: `M${left + radius} ${top} H${right - radius} ${topRight} V${bottom - radius} ${bottomRight} H${left + radius} ${bottomLeft} V${top + radius} ${topLeft} Z`,
      corners: [
        `M${left} ${top + leg} V${top + radius} ${topLeft} H${left + leg}`,
        `M${right - leg} ${top} H${right - radius} ${topRight} V${top + leg}`,
        `M${right} ${bottom - leg} V${bottom - radius} ${bottomRight} H${right - leg}`,
        `M${left + leg} ${bottom} H${left + radius} ${bottomLeft} V${bottom - leg}`,
      ].join(" "),
    };
  });
  const shade = useAnimatedProps(() => ({
    d: `M0 0 H${width} V${height} H0 Z ${frame.value.outline}`,
  }));
  const corners = useAnimatedProps(() => ({ d: frame.value.corners }));

  useEffect(() => {
    if (
      closing ||
      permission?.status !== "undetermined" ||
      !isFocused ||
      !scanningEnabled ||
      nfcSessionPending ||
      !requestCameraOnFocus ||
      permissionRequestStarted.current
    )
      return;
    requestCamera();
  }, [
    closing,
    isFocused,
    nfcSessionPending,
    permission?.status,
    requestCamera,
    requestCameraOnFocus,
    scanningEnabled,
  ]);

  useEffect(() => {
    if (!isFocused && !closing) {
      locked.current = false;
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
      scanCandidate.current = null;
      setTorchEnabled(false);
      setManualEntryVisible(false);
    }
  }, [closing, isFocused]);

  useEffect(() => {
    scanCandidate.current = null;
    if (scanningEnabled) locked.current = false;
  }, [scanningEnabled]);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (locked.current) return;
      const observation = getBarcodeFrameObservation(result, { height, width }, frameSize);
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
      void haptic("light");
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
      unlockTimer.current = setTimeout(() => {
        locked.current = false;
      }, 1200);
      onValue(result.data);
    },
    [frameSize, height, onValue, width],
  );

  function nfcPermissionButton() {
    if (!onNfc) return null;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !scanningEnabled }}
        disabled={!scanningEnabled}
        onPress={onNfc}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>{t("scannerNfcScan")}</Text>
      </Pressable>
    );
  }

  if (!permission || nfcSessionPending) return <View style={styles.black} />;
  if (permission.status === "undetermined") {
    if (!scanningEnabled || (requestCameraOnFocus && !permissionError))
      return <View style={styles.black} />;
    return (
      <View
        style={[
          styles.permission,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
      >
        {permissionError ? (
          <RequestFeedback error={permissionError} onRetry={requestCamera} />
        ) : null}
        <Pressable accessibilityRole="button" onPress={requestCamera} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{t("scannerCamera")}</Text>
        </Pressable>
        {nfcPermissionButton()}
        {onClose ? (
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{t("close")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (!permission.granted) {
    if (!scanningEnabled) return <View style={styles.black} />;
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
        {nfcPermissionButton()}
        {permissionError ? (
          <RequestFeedback error={permissionError} onRetry={requestCamera} />
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void Linking.openSettings().catch((cause) =>
              setPermissionError(cause instanceof Error ? cause : new Error(String(cause))),
            )
          }
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>{t("mobileSurfaceOpenSettings")}</Text>
        </Pressable>
        {permission.canAskAgain && Platform.OS !== "ios" ? (
          <Pressable
            accessibilityRole="button"
            onPress={requestCamera}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{t("scannerRetryCamera")}</Text>
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
      {isFocused || closing ? (
        <CameraView
          active={isFocused || closing}
          // The preview only scans barcodes; it must never win hit-testing
          // over the controls rendered above it (toolbar, queue, flashlight,
          // and manual-entry buttons) on iOS 18's native camera surface.
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={cameraControls.showTorch && torchEnabled}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={
            scanningEnabled && !closing && !manualEntryVisible ? handleBarcodeScanned : undefined
          }
        />
      ) : null}
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
        <AnimatedPath animatedProps={shade} fill="rgba(0,0,0,0.54)" fillRule="evenodd" />
        <AnimatedPath
          animatedProps={corners}
          fill="none"
          stroke="white"
          strokeWidth={6}
          strokeLinecap="round"
        />
      </Svg>
      {hint === null ? null : (
        <Text
          maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
          pointerEvents="none"
          style={[styles.hint, { top: height / 2 + frameSize / 2 + 24 }]}
        >
          {hint ?? t("scannerQrHint")}
        </Text>
      )}
      {onNfc ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          colorScheme="dark"
          style={[styles.cameraControl, { bottom: tabBarBottomInset + 76 }]}
        >
          <Pressable
            accessibilityLabel={t("scannerNfcScan")}
            accessibilityRole="button"
            accessibilityState={{ disabled: !scanningEnabled }}
            disabled={!scanningEnabled}
            onPress={onNfc}
            style={styles.cameraControlPressable}
          >
            <SymbolView name="wave.3.right" tintColor="white" size={23} weight="semibold" />
          </Pressable>
        </GlassView>
      ) : null}
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
          testID={UI_TEST_IDS.scanner.manualEntry}
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
          style={[
            styles.backControl,
            { top: insets.top + 12 },
            // With a side column the control stands in it, top-aligned like a system back.
            sideRegion.edge && {
              left: undefined,
              [sideRegion.edge]: Math.max(8, (sideRegion.size - 44) / 2),
            },
          ]}
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
      <ScannerCodeEntry
        visible={manualEntryVisible}
        onClose={() => setManualEntryVisible(false)}
        onValue={onValue}
      />
    </View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const FRAME_RADIUS = 28;
const styles = StyleSheet.create({
  black: { backgroundColor: "#000", flex: 1 },
  hint: {
    color: "white",
    fontSize: type.callout.fontSize,
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
    borderRadius: radius.full,
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
  permissionTitle: { color: colors.label, fontSize: type.title2.fontSize, fontWeight: "700" },
  permissionBody: {
    color: colors.secondaryLabel,
    fontSize: type.callout.fontSize,
    lineHeight: 22,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderCurve: "continuous",
    borderRadius: radius.full,
    marginTop: 8,
    minWidth: 200,
    padding: 14,
  },
  primaryButtonText: {
    color: colors.accentText,
    fontSize: type.callout.fontSize,
    fontWeight: "700",
    textAlign: "center",
  },
  secondaryButton: { padding: 12 },
  secondaryButtonText: { color: colors.accent, fontSize: type.callout.fontSize, fontWeight: "600" },
});
