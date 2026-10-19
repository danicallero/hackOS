import { useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { Platform } from "react-native";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { HeaderBackButton, hasScreenBelow } from "@/components/header-back-button";
import { useLocale } from "@/lib/i18n";
import { safeBack, useTabStackScreenOptions } from "@/lib/navigation";
import { colors } from "@/theme/colors";
export default function ProjectsLayout() {
  const router = useRouter();
  const { t } = useLocale();
  const stackScreenOptions = useTabStackScreenOptions();
  const glassAvailable = isRealLiquidGlassAvailable();
  // [id], gallery and queue render their own `EntryBackToolbar` on iOS 26+ when they
  // are the first screen of this stack (the native item has nothing to pop to); with a
  // screen below them the native back item is kept.
  const ownBack = ({
    navigation,
    route,
  }: {
    navigation: { getState(): { routes: { key: string }[] } | undefined };
    route: { key: string };
  }) => (glassAvailable && !hasScreenBelow(navigation, route.key) ? false : undefined);
  return (
    <Stack
      screenOptions={({ navigation }) => ({
        ...stackScreenOptions,
        contentStyle: { ...stackScreenOptions.contentStyle, backgroundColor: colors.background },
        headerShadowVisible: false,
        // The native back item can join a vertical bar; only a cold deep link
        // (nothing to pop in this screen's own stack) needs the explicit one.
        // No `headerLeft` key at all on iOS 26+: even an undefined one can displace the
        // screens' left toolbar items.
        ...(glassAvailable || navigation.getState().index > 0
          ? {}
          : {
              headerLeft: () => (
                <HeaderBackButton onPress={() => safeBack(router, "/(tabs)/queue")} />
              ),
            }),
      })}
    >
      <Stack.Screen
        name="[id]"
        options={(props) => ({
          headerBackVisible: ownBack(props),
          headerLargeTitle: true,
          headerLargeTitleShadowVisible: false,
          title: t("projectFields"),
        })}
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
        options={(props) => ({
          headerBackVisible: ownBack(props),
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerTransparent: Platform.OS === "ios",
          title: t("gallery"),
        })}
      />
      {/* Compact title over the scrolling queue, like Open-source licenses: iOS blurs the scroll edge. */}
      <Stack.Screen
        name="queue"
        options={(props) => ({
          headerBackVisible: ownBack(props),
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerTransparent: Platform.OS === "ios",
          title: t("projectQueue"),
        })}
      />
    </Stack>
  );
}
