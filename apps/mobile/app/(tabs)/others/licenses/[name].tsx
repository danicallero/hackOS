import { useLocalSearchParams } from "expo-router";
import { LicenseScreen } from "@/components/licenses-screen";

export default function LicenseRoute() {
  const { name = "" } = useLocalSearchParams<{ name: string }>();
  return <LicenseScreen name={name} />;
}
