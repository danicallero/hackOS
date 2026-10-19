import type { ComponentType, ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { SideRegionProvider, sideRegionForInsets } from "@/lib/side-region";
import { useSideInsets } from "@/lib/vertical-bar-edge";
import { maxContentWidth } from "@/lib/window-size";
import { colors } from "@/theme/colors";

/**
 * Lays the navigator out in the space the app really has:
 *
 * - With `padSides` (sheets and modals) horizontal safe-area insets are applied
 *   here, on each edge independently. On a foldable iPhone the system status
 *   indicators and the Dynamic Island run down one side (the insets are
 *   asymmetric and follow the pose), and a plain `ScrollView` never insets for
 *   them, so content would slide under them. The background still fills the
 *   whole display. Children then get their own `SafeAreaProvider`, so what they
 *   read is only the inset that is left.
 * - The root navigator passes `padSides={false}`: its screens pad themselves
 *   (`contentStyle`), and the tab layout keeps the side column free for its bar.
 * - Content stops growing at `maxContentWidth` and is centred on wider windows.
 *
 * The tree is the same at every width and every pose (only styles change), so
 * folding, unfolding or resizing never remounts the navigator or loses a draft.
 */
export function AdaptiveFrame({
  children,
  padSides = true,
}: {
  children: ReactNode;
  padSides?: boolean;
}) {
  const safeInsets = useSafeAreaInsets();
  const sideInsets = useSideInsets();
  const insets = { ...safeInsets, left: sideInsets.left, right: sideInsets.right };
  const { width, height } = useWindowDimensions();
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.background,
        flex: 1,
        paddingLeft: padSides ? insets.left : 0,
        paddingRight: padSides ? insets.right : 0,
      }}
    >
      <View style={{ flex: 1, maxWidth: maxContentWidth(width), width: "100%" }}>
        <SideRegionProvider value={sideRegionForInsets(insets)}>
          {padSides ? (
            <SafeAreaProvider
              initialMetrics={{
                frame: { x: 0, y: 0, width: width - insets.left - insets.right, height },
                insets: { top: insets.top, bottom: insets.bottom, left: 0, right: 0 },
              }}
            >
              {children}
            </SafeAreaProvider>
          ) : (
            children
          )}
        </SideRegionProvider>
      </View>
    </View>
  );
}

/**
 * A native modal sheet is its own view controller: the system gives it its own
 * safe area (on the outer display a sheet's toolbar stands in a side column) and
 * the app-level insets do not describe it. Measure the sheet itself, then frame it.
 */
export function SheetFrame({ children }: { children: ReactNode }) {
  const parent = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width, height },
        insets: { top: parent.top, bottom: parent.bottom, left: parent.left, right: parent.right },
      }}
    >
      <AdaptiveFrame>{children}</AdaptiveFrame>
    </SafeAreaProvider>
  );
}

/** Route wrapper for screens presented as native modal sheets. */
export function withSheetFrame<Props extends object>(Screen: ComponentType<Props>) {
  function Framed(props: Props) {
    return (
      <SheetFrame>
        <Screen {...props} />
      </SheetFrame>
    );
  }
  Framed.displayName = `SheetFrame(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Framed;
}
