import { withSheetFrame } from "@/components/adaptive-frame";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import NetworkingProfileScreen from "@/components/networking-profile-screen";

const FramedNetworkingProfile = withSheetFrame(NetworkingProfileScreen);

/** H55: native header insets track a directly attached scroll view. */
export default function NetworkingProfileRoute() {
  return process.env.EXPO_OS === "ios" && isRealLiquidGlassAvailable() ? (
    <NetworkingProfileScreen />
  ) : (
    <FramedNetworkingProfile />
  );
}
