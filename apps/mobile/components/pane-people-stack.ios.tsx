import { createNativeStackNavigator } from "expo-router/native-stack";
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  NavigationIndependentTree,
  useNavigationContainerRef,
} from "expo-router/react-navigation";
import { useEffect, useState } from "react";
import { useColorScheme, View } from "react-native";
import type { PanePeopleStackProps } from "@/components/pane-people-stack";
import { PeopleDirectoryScreen } from "@/components/people-directory-screen";
import { paneRootHeaderOptions } from "@/lib/screen-header-options";
import { colors } from "@/theme/colors";
import { PANE_BAR_INSET } from "@/theme/screen-title";

export const NATIVE_PANE_STACK = true;

const Stack = createNativeStackNavigator();

/**
 * H22-H26, H55: on iOS the pane is a real native navigation stack inside the pane's own view
 * (an independent tree, so the app's router is untouched). Its root draws the pane's title and
 * trailing items in a native bar; "people" is pushed over it with the native large title,
 * integrated search, back item and filter, exactly like the standalone People screen. The route's
 * own header is hidden by the host while this is active, so every bar button belongs to the pane.
 */
export function PanePeopleStack(props: PanePeopleStackProps) {
  if (!props.enabled) return <>{props.children}</>;
  return <NativePaneStack {...props} />;
}

function NativePaneStack({
  backLabel,
  children,
  onClose,
  onSelect,
  open,
  requireBadge,
  rootHeaderRight,
  rootTitle,
}: PanePeopleStackProps) {
  const scheme = useColorScheme();
  const navigation = useNavigationContainerRef();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready || !navigation.isReady()) return;
    const current = (navigation.getCurrentRoute() as { name?: string } | undefined)?.name;
    if (open && current !== "people") navigation.navigate("people" as never);
    else if (!open && current === "people") navigation.goBack();
  }, [navigation, open, ready]);

  return (
    <View style={{ flex: 1, paddingHorizontal: PANE_BAR_INSET }}>
      <NavigationIndependentTree>
        <NavigationContainer
          ref={navigation}
          onReady={() => setReady(true)}
          theme={scheme === "dark" ? DarkTheme : DefaultTheme}
        >
          <Stack.Navigator
            screenOptions={{
              contentStyle: { backgroundColor: colors.background },
              headerShadowVisible: false,
            }}
          >
            <Stack.Screen
              name="pane"
              options={paneRootHeaderOptions({
                title: rootTitle ?? "",
                trailing: rootHeaderRight ?? [],
              })}
            >
              {() => children}
            </Stack.Screen>
            <Stack.Screen
              name="people"
              listeners={{ beforeRemove: () => onClose() }}
              options={{ headerBackButtonDisplayMode: "minimal" }}
            >
              {() => (
                <PeopleDirectoryScreen
                  backLabel={backLabel}
                  embedded
                  nativeHeader
                  onSelect={onSelect}
                  requireBadge={requireBadge}
                />
              )}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </View>
  );
}
