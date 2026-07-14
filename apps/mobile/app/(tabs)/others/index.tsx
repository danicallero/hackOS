import { Redirect } from "expo-router";

/** With five tabs this is the Account tab; overflow users never open this route. */
export default function OthersMenuScreen() {
  return <Redirect href="/(tabs)/others/account" />;
}
