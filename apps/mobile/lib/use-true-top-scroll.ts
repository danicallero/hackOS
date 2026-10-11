import { useScrollToTop } from "expo-router";
import { type RefObject, useCallback, useMemo, useRef } from "react";
import { type NativeScrollEvent, type NativeSyntheticEvent, Platform } from "react-native";

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

/** ScrollView, FlatList or SectionList ref: whichever scroll method it exposes. */
export type TrueTopScrollable = {
  scrollTo?: (options: { y: number; animated?: boolean }) => void;
  scrollToOffset?: (options: { offset: number; animated?: boolean }) => void;
};

export type TrueTopState = {
  /** Content offset of the true top: negative under iOS's automatic inset. */
  top: number;
  offset: number;
  dragged: boolean;
  moving: boolean;
};

/**
 * Next state after a scroll event (#935). Offsets seen before the first drag
 * are the automatic inset settling, so their minimum is the true top. `restore`
 * flags iOS restoring a remounted scroll view (e.g. back from the browser) to
 * y 0: it clamps restored offsets to the raw inset, not the automatic one.
 */
export function trueTopScrollStep(
  state: TrueTopState,
  y: number,
  platform: string,
): { state: TrueTopState; restore: boolean } {
  const top = state.dragged ? state.top : Math.min(state.top, y);
  const restore =
    platform === "ios" && !state.moving && top < 0 && y === 0 && Math.abs(state.offset - top) < 1;
  return { state: { ...state, top, offset: y }, restore };
}

/**
 * Keep a scroll view's "top" at its true top on iOS (#935). With
 * `contentInsetAdjustmentBehavior="automatic"` the top rests at a negative
 * offset, but `useScrollToTop` scrolls to y 0 and iOS clamps programmatic and
 * restored offsets to the raw inset (0), so a tab re-press or a return to the
 * app left the page that far below its top. Spread `scrollProps` onto the
 * scroll view (compose `onScroll` with the screen's own handler if it has one);
 * this replaces `useScrollToTop(ref)`. Android rests at 0 and is unchanged.
 */
export function useTrueTopScroll(ref: RefObject<TrueTopScrollable | null>) {
  const state = useRef<TrueTopState>({ top: 0, offset: 0, dragged: false, moving: false });

  const scrollToTop = useCallback(
    (animated = true) => {
      const node = ref.current;
      const y = state.current.top;
      if (node?.scrollToOffset) node.scrollToOffset({ animated, offset: y });
      else node?.scrollTo?.({ animated, y });
    },
    [ref],
  );

  const topRef = useMemo(
    () => ({ current: { scrollToTop: () => scrollToTop(true) } }),
    [scrollToTop],
  );
  useScrollToTop(topRef);

  const onScroll = useCallback(
    (event: ScrollEvent) => {
      const next = trueTopScrollStep(state.current, event.nativeEvent.contentOffset.y, Platform.OS);
      state.current = next.state;
      if (next.restore) scrollToTop(false);
    },
    [scrollToTop],
  );

  const scrollProps = useMemo(
    () => ({
      onScroll,
      onScrollBeginDrag: () => {
        state.current = { ...state.current, dragged: true, moving: true };
      },
      onScrollEndDrag: () => {
        state.current = { ...state.current, moving: false };
      },
      onMomentumScrollBegin: () => {
        state.current = { ...state.current, moving: true };
      },
      onMomentumScrollEnd: () => {
        state.current = { ...state.current, moving: false };
      },
      scrollEventThrottle: 16,
      // Without it iOS clamps the negative true top to y 0.
      scrollToOverflowEnabled: true,
    }),
    [onScroll],
  );

  return { scrollProps, scrollToTop, state };
}
