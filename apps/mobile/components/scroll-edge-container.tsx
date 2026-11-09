import { requireNativeView, requireOptionalNativeModule } from "expo";
import { Platform, View, type ViewProps } from "react-native";

/** H45: extend UIKit's own edge effect behind a pinned section header. */
type Props = ViewProps & { title: string; horizontalInset: number };

const NativeContainer =
  Platform.OS === "ios" && requireOptionalNativeModule("ScrollEdgeContainer")
    ? requireNativeView<Props>("ScrollEdgeContainer")
    : View;

export function ScrollEdgeContainer({ children, title, horizontalInset, ...props }: Props) {
  return NativeContainer === View ? (
    <View {...props}>{children}</View>
  ) : (
    <NativeContainer {...props} title={title} horizontalInset={horizontalInset} />
  );
}
