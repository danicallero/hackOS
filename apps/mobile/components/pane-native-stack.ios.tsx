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
import type { PaneNativeStackProps } from "@/components/pane-native-stack";
import { colors } from "@/theme/colors";
import { PANE_BAR_INSET } from "@/theme/screen-title";

export const NATIVE_PANE_STACK = true;

const Stack = createNativeStackNavigator();

/**
 * H22-H26, H55: on iOS a pane is a real native navigation stack inside its own view (an
 * independent tree, so the app's router is untouched). Its root draws the pane's title and trailing
 * items in a native bar, and the optional pushed screen (the people finder) slides over it with its
 * own bar, back item and large title. The route's header is hidden by the host while this is
 * active, so nothing transparent covers the pane and every bar button is a real, pressable item.
 */
export function PaneNativeStack({ children, enabled, pushed, rootOptions }: PaneNativeStackProps) {
  if (!enabled) return <>{children}</>;
  return (
    <NativePane pushed={pushed} rootOptions={rootOptions}>
      {children}
    </NativePane>
  );
}

function NativePane({ children, pushed, rootOptions }: Omit<PaneNativeStackProps, "enabled">) {
  const scheme = useColorScheme();
  const navigation = useNavigationContainerRef();
  const [ready, setReady] = useState(false);
  const open = pushed?.open ?? false;

  useEffect(() => {
    if (!ready || !navigation.isReady()) return;
    const current = (navigation.getCurrentRoute() as { name?: string } | undefined)?.name;
    if (open && current !== "pushed") navigation.navigate("pushed" as never);
    else if (!open && current === "pushed") navigation.goBack();
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
            <Stack.Screen name="root" options={rootOptions}>
              {() => children}
            </Stack.Screen>
            {pushed ? (
              <Stack.Screen
                name="pushed"
                listeners={{ beforeRemove: () => pushed.onClose() }}
                options={pushed.options}
              >
                {() => pushed.render()}
              </Stack.Screen>
            ) : null}
          </Stack.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </View>
  );
}
