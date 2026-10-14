import { Stack, useRouter } from "expo-router";
import { useRef } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import { Section, Separator } from "@/components/native-ui";
import { SymbolView } from "@/components/symbol";
import { findLicense, LICENSES } from "@/lib/licenses";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { colors } from "@/theme/colors";

function useLegalScroll() {
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  const trueTop = useTrueTopScroll(scrollRef);
  return {
    ref: scrollRef,
    ...trueTop.scrollProps,
    contentInsetAdjustmentBehavior: "automatic" as const,
    contentContainerStyle: {
      gap: 20,
      padding: 16,
      paddingBottom: Math.max(32, tabBarBottomInset + 16),
    },
  };
}

/** Account → Legal → the packages shipped in the app, with their license (`assets/licenses.json`). */
export function LicensesScreen() {
  const router = useRouter();
  const scroll = useLegalScroll();
  return (
    <ScrollView {...scroll}>
      <Section>
        {LICENSES.map((entry, index) => (
          <View key={`${entry.name}@${entry.version}`}>
            {index > 0 ? <Separator /> : null}
            <Pressable
              accessibilityLabel={`${entry.name}, ${entry.license}`}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/others/licenses/[name]",
                  params: { name: entry.name },
                })
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              {/* Stacked: package names and license expressions are both long. */}
              <View
                style={{
                  alignItems: "center",
                  flexDirection: "row",
                  gap: 12,
                  minHeight: 50,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.label, fontSize: 16 }}>{entry.name}</Text>
                  <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                    {entry.license}
                  </Text>
                </View>
                <SymbolView
                  accessible={false}
                  name="chevron.right"
                  size={12}
                  tintColor={colors.tertiaryLabel}
                  weight="semibold"
                />
              </View>
            </Pressable>
          </View>
        ))}
      </Section>
    </ScrollView>
  );
}

/** One package's notice, as its authors ship it. */
export function LicenseScreen({ name }: { name: string }) {
  const scroll = useLegalScroll();
  const entry = findLicense(name);
  return (
    <ScrollView {...scroll}>
      <Stack.Screen options={{ title: name }} />
      {entry ? (
        <Section>
          <View style={{ gap: 12, padding: 16 }}>
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 15 }}>
              {entry.version} · {entry.license}
            </Text>
            {entry.text ? (
              <Text
                selectable
                style={{
                  color: colors.label,
                  fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
                  fontSize: 12,
                  lineHeight: 17,
                }}
              >
                {entry.text}
              </Text>
            ) : null}
          </View>
        </Section>
      ) : null}
    </ScrollView>
  );
}
