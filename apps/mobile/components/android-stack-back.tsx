import { useNavigation } from "expo-router";
import { View } from "react-native";
import { LegacyBackButton } from "@/components/native-ui";

/**
 * The native bar's back item on Android: the same glass circle as
 * `AndroidDetailHeader` and the hero screens, instead of Material's bare arrow,
 * so every pushed screen leads the same way (H55). Nothing when the stack has
 * no screen below; cold-link screens set their own `headerLeft`.
 */
export function AndroidStackBack({ canGoBack }: { canGoBack?: boolean }) {
  const navigation = useNavigation();
  if (!canGoBack) return null;
  return (
    <View style={{ marginRight: 12 }}>
      <LegacyBackButton onPress={() => navigation.goBack()} />
    </View>
  );
}
