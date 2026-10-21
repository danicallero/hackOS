import { Platform, RefreshControl, type RefreshControlProps } from "react-native";
import { colors } from "@/theme";

/**
 * The app's one RefreshControl. iOS keeps UIRefreshControl; Android's stock
 * swipe-refresh disc is Material green-on-white with a shadow, so it is flattened
 * to the scheme's surface with the accent arc (H55, H59). Drop-in replacement.
 */
export function AppRefreshControl(props: RefreshControlProps) {
  if (Platform.OS !== "android") return <RefreshControl {...props} />;
  return (
    <RefreshControl
      colors={[String(colors.secondaryLabel)]}
      progressBackgroundColor={String(colors.elevatedSurface)}
      {...props}
    />
  );
}
