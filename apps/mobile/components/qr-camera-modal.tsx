import { createContext, type ReactNode, useLayoutEffect, useState } from "react";
import { Modal, Platform, StyleSheet, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export const QrCameraClosing = createContext(false);

type Props = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function QrCameraModal({ visible, onClose, children }: Props) {
  if (Platform.OS === "ios") {
    return (
      <IosCameraModal visible={visible} onClose={onClose}>
        {children}
      </IosCameraModal>
    );
  }
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {visible ? children : null}
    </Modal>
  );
}

function IosCameraModal({ visible, onClose, children }: Props) {
  const reducedMotion = useReducedMotion();
  const { height, width } = useWindowDimensions();
  const [presented, setPresented] = useState(visible);
  const zoom = useSharedValue(0);
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  useLayoutEffect(() => {
    if (visible) {
      if (!presented) {
        zoom.value = 0;
        x.value = 0;
        y.value = 0;
        setPresented(true);
      } else {
        zoom.value = withTiming(1, { duration: reducedMotion ? 0 : 190 });
        x.value = withTiming(0);
        y.value = withTiming(0);
      }
    } else if (presented) {
      // H22–H26: keep the camera and its black backing together until the
      // card is invisible. The transparent native host can then dismiss
      // without exposing its default background during CameraView teardown.
      zoom.value = withTiming(0, { duration: reducedMotion ? 0 : 190 }, (finished) => {
        if (finished) runOnJS(setPresented)(false);
      });
    }
  }, [presented, reducedMotion, visible, x, y, zoom]);

  const dismiss = Gesture.Pan()
    .enabled(visible)
    .minDistance(14)
    .failOffsetX(-14)
    .failOffsetY(-14)
    .maxPointers(1)
    .onUpdate(({ translationX, translationY }) => {
      x.value = Math.max(0, translationX);
      y.value = Math.max(0, translationY);
    })
    .onEnd(({ translationX, translationY, velocityX, velocityY }, success) => {
      if (
        success &&
        (translationX > 90 ||
          translationY > 90 ||
          (translationX > 24 && velocityX > 650) ||
          (translationY > 24 && velocityY > 650))
      ) {
        runOnJS(onClose)();
        return;
      }
      x.value = withTiming(0, { duration: 160 });
      y.value = withTiming(0, { duration: 160 });
    });
  const card = useAnimatedStyle(() => {
    const drag = Math.min(1, Math.max(x.value / width, y.value / height));
    return {
      opacity: zoom.value,
      borderRadius: (1 - zoom.value + drag) * 32,
      transform: [
        { translateX: x.value },
        { translateY: y.value },
        { scale: reducedMotion ? 1 : (0.78 + zoom.value * 0.22) * (1 - drag * 0.35) },
      ],
    };
  });

  return (
    <Modal transparent visible={presented} animationType="none" onRequestClose={onClose}>
      {presented ? (
        <GestureHandlerRootView style={styles.root}>
          <GestureDetector gesture={dismiss}>
            <Animated.View
              accessibilityElementsHidden={!visible}
              style={[styles.card, card]}
              pointerEvents={visible ? "auto" : "none"}
            >
              <QrCameraClosing.Provider value={!visible}>{children}</QrCameraClosing.Provider>
            </Animated.View>
          </GestureDetector>
        </GestureHandlerRootView>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: { flex: 1, backgroundColor: "black", overflow: "hidden" },
});
