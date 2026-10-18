import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Separator } from "@/components/native-ui";
import { findLicense, LICENSES, type LicenseEntry } from "@/lib/licenses";
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
    contentContainerStyle: { paddingBottom: Math.max(32, tabBarBottomInset + 16) },
  };
}

function SourceLink({ url }: { url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      hitSlop={8}
      onPress={() => void WebBrowser.openBrowserAsync(url)}
      style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
    >
      <Text numberOfLines={1} style={{ color: colors.tertiaryLabel, fontSize: 13 }}>
        {url.replace(/^https:\/\//, "")}
      </Text>
    </Pressable>
  );
}

function NoticeText({ entry, preview }: { entry: LicenseEntry; preview: boolean }) {
  // Without a notice file the license id stands in.
  return (
    <Text
      selectable={!preview}
      numberOfLines={preview ? 4 : undefined}
      style={{ color: colors.secondaryLabel, fontSize: 16, lineHeight: 22 }}
    >
      {entry.text ?? entry.license}
    </Text>
  );
}

/**
 * Account → Legal → every package shipped in the app (`assets/licenses.json`):
 * its notice, truncated, and its source. A package opens its full notice.
 */
export function LicensesScreen() {
  const router = useRouter();
  const scroll = useLegalScroll();
  return (
    <ScrollView {...scroll}>
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
            style={({ pressed }) => ({
              gap: 10,
              opacity: pressed ? 0.6 : 1,
              paddingHorizontal: 16,
              paddingVertical: 18,
            })}
          >
            <Text style={{ color: colors.label, fontSize: 19, fontWeight: "500" }}>
              {entry.name}
            </Text>
            <NoticeText entry={entry} preview />
            {entry.source ? <SourceLink url={entry.source} /> : null}
          </Pressable>
        </View>
      ))}
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
        <View style={{ gap: 12, paddingHorizontal: 16, paddingVertical: 18 }}>
          <View style={{ gap: 4 }}>
            <Text selectable style={{ color: colors.tertiaryLabel, fontSize: 13 }}>
              {entry.version} · {entry.license}
            </Text>
            {entry.source ? <SourceLink url={entry.source} /> : null}
          </View>
          {entry.text ? <NoticeText entry={entry} preview={false} /> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
