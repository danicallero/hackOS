import { withSheetFrame } from "@/components/adaptive-frame";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import NetworkingProfileScreen from "@/components/networking-profile-screen";

const FramedNetworkingProfile = withSheetFrame(NetworkingProfileScreen);

/** H55: the native large title tracks a directly attached scroll view. */
export default function NetworkingProfileRoute() {
  return process.env.EXPO_OS === "ios" && isRealLiquidGlassAvailable() ? (
    <NetworkingProfileScreen />
  ) : (
    <FramedNetworkingProfile />
  );
}
