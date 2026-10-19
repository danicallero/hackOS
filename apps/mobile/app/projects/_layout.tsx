import { useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { Platform } from "react-native";
import { HeaderBackButton } from "@/components/header-back-button";
import { useLocale } from "@/lib/i18n";
import { useTabStackScreenOptions } from "@/lib/navigation";
import { colors } from "@/theme/colors";
export default function ProjectsLayout() {
  const router = useRouter();
  const { t } = useLocale();
  const stackScreenOptions = useTabStackScreenOptions();
  return (
    <Stack
      screenOptions={{
        ...stackScreenOptions,
        contentStyle: { ...stackScreenOptions.contentStyle, backgroundColor: colors.background },
        headerShadowVisible: false,
        // The native back item can join a vertical bar; only a cold deep link
        // (nothing to pop) needs the explicit one.
        headerLeft: router.canGoBack()
          ? undefined
          : () => <HeaderBackButton onPress={() => router.replace("/(tabs)/queue")} />,
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
      <Stack.Screen name="challenge" options={{ title: "" }} />
      <Stack.Screen
        name="challenges"
        options={{
          headerBlurEffect: "none",
          headerShadowVisible: false,
          // The grouped list's page colour, so the sheet's bar and body read as one surface.
          headerStyle: { backgroundColor: colors.background },
          presentation: "modal",
          title: t("projectChallenges"),
        }}
      />
      <Stack.Screen
        name="github"
        options={{
          headerBlurEffect: "none",
          headerShadowVisible: false,
          // Same surface as the challenges sheet.
          headerStyle: { backgroundColor: colors.background },
          presentation: "modal",
          title: t("githubChooseRepo"),
        }}
      />
      <Stack.Screen
        name="invite"
        options={{
          contentStyle: { backgroundColor: colors.surface },
          headerBlurEffect: "none",
          headerShadowVisible: false,
          headerTransparent: true,
          presentation: "modal",
          title: t("projectInvite"),
        }}
      />
      <Stack.Screen
        name="gallery"
        options={{
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerTransparent: Platform.OS === "ios",
          title: t("gallery"),
        }}
      />
      {/* Compact title over the scrolling queue, like Open-source licenses: iOS blurs the scroll edge. */}
      <Stack.Screen
        name="queue"
        options={{
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerTransparent: Platform.OS === "ios",
          title: t("projectQueue"),
        }}
      />
    </Stack>
  );
}
