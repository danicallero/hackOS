import { useRouter } from "expo-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { BackHandler, Platform, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSideInsets } from "@/lib/vertical-bar-edge";

const DockBackGestureContext = createContext<ReturnType<typeof Gesture.Pan> | null>(null);
export const useDockBackGesture = () => useContext(DockBackGestureContext);

type Dismiss = () => void;
const BackDismissContext = createContext<((dismiss: Dismiss) => () => void) | null>(null);

/** H55: an in-page credential or queue closes before navigation goes back. */
export function useBackDismiss(open: boolean, dismiss: Dismiss) {
  const register = useContext(BackDismissContext);
  useEffect(() => {
    if (!open) return;
    const unregister = register?.(dismiss);
    const back =
      Platform.OS === "android"
        ? BackHandler.addEventListener("hardwareBackPress", () => {
            dismiss();
            return true;
          })
        : null;
    return () => {
      unregister?.();
      back?.remove();
    };
  }, [open, register, dismiss]);
}

/** H55: the dock is outside the child native stack, but still accepts a back swipe. */
export function AppBackGesture({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const side = useSideInsets();
  const dismissers = useRef<Dismiss[]>([]);
  const register = useCallback((dismiss: Dismiss) => {
    dismissers.current.push(dismiss);
    return () => {
      dismissers.current = dismissers.current.filter((item) => item !== dismiss);
    };
  }, []);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(Platform.OS === "ios")
        .runOnJS(true)
        .activeOffsetX(24)
        .failOffsetX(-12)
        .failOffsetY([-20, 20])
        .onTouchesDown((event, manager) => {
          const touch = event.allTouches[0];
          if (!touch) {
            manager.fail();
            return;
          }
          const dismiss = dismissers.current.length > 0;
          const dock =
            touch.x <= side.left || touch.x >= width - side.right || touch.y >= height - 110;
          if ((!dock && !(dismiss && touch.x <= 24)) || (!dismiss && !router.canGoBack()))
            manager.fail();
        })
        .onEnd((event) => {
          if (event.translationX < 64) return;
          const dismiss = dismissers.current.at(-1);
          if (dismiss) dismiss();
          else if (router.canGoBack()) router.back();
        }),
    [router, side.left, side.right, width, height],
  );
  return (
    <BackDismissContext.Provider value={register}>
      <DockBackGestureContext.Provider value={gesture}>
        <GestureDetector gesture={gesture}>
          <View style={{ flex: 1 }} collapsable={false}>
            {children}
          </View>
        </GestureDetector>
      </DockBackGestureContext.Provider>
    </BackDismissContext.Provider>
  );
}
