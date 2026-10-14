import { useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { HeaderBackButton } from "@/components/header-back-button";
import { useLocale } from "@/lib/i18n";
import { nativeStackScreenOptions } from "@/lib/navigation";
import { colors } from "@/theme/colors";
export default function ProjectsLayout() {
  const router = useRouter();
  const { t } = useLocale();
  return (
    <Stack
      screenOptions={{
        ...nativeStackScreenOptions,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerLeft: () => (
          <HeaderBackButton
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/queue"))}
          />
        ),
      }}
    >
      <Stack.Screen
        name="[id]"
        options={{
          headerLargeTitle: true,
          headerLargeTitleShadowVisible: false,
          title: t("projectFields"),
        }}
      />
      <Stack.Screen name="challenges" options={{ title: t("projectChallenges") }} />
      <Stack.Screen name="invite" options={{ presentation: "modal", title: t("projectInvite") }} />
      <Stack.Screen name="gallery" options={{ title: t("gallery") }} />
      <Stack.Screen name="queue" options={{ title: t("projectQueue") }} />
    </Stack>
  );
}
