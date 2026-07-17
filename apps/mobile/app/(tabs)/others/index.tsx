import { Redirect } from "expo-router";

/** With five participant tabs this is Account; overflow users open a menu over this route. */
export default function OthersMenuScreen() {
  return <Redirect href="/(tabs)/others/account" />;
}
