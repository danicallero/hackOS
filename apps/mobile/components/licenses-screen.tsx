import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { Separator } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { findLicense, LICENSES, type LicenseEntry } from "@/lib/licenses";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { colors, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

function useLegalScroll() {
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const readable = useParticipantLayout("form");
  const scrollRef = useRef<ScrollView>(null);
  const trueTop = useTrueTopScroll(scrollRef);
  return {
    ref: scrollRef,
    ...trueTop.scrollProps,
    contentInsetAdjustmentBehavior: "automatic" as const,
    // Rows carry their own 16pt inset, so the column adds only what the gutter exceeds it by.
    contentContainerStyle: {
      ...readable.content,
      paddingBottom: Math.max(32, tabBarBottomInset + 16),
      paddingHorizontal: Math.max(0, readable.gutter - 16),
    },
  };
}

function SourceLink({ url }: { url: string }) {
  return (
    <PressableFeedback
      feedback="opacity"
      accessibilityRole="link"
      hitSlop={8}
      onPress={() => void WebBrowser.openBrowserAsync(url)}
      style={{ alignSelf: "flex-start" }}
    >
      <Text
        numberOfLines={1}
        style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}
      >
        {url.replace(/^https:\/\//, "")}
      </Text>
    </PressableFeedback>
  );
}

function NoticeText({ entry, preview }: { entry: LicenseEntry; preview: boolean }) {
  // Without a notice file the license id stands in.
  return (
    <Text
      selectable={!preview}
      numberOfLines={preview ? 4 : undefined}
      style={{ color: colors.secondaryLabel, fontSize: type.callout.fontSize, lineHeight: 22 }}
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
          <PressableFeedback
            feedback="opacity"
            accessibilityLabel={`${entry.name}, ${entry.license}`}
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/(tabs)/others/licenses/[name]",
                params: { name: entry.name },
              })
            }
            style={{ gap: 10, paddingHorizontal: 16, paddingVertical: 18 }}
          >
            <Text
              style={{ color: colors.label, fontSize: type.title3.fontSize, fontWeight: "500" }}
            >
              {entry.name}
            </Text>
            <NoticeText entry={entry} preview />
            {entry.source ? <SourceLink url={entry.source} /> : null}
          </PressableFeedback>
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
            <Text
              selectable
              style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}
            >
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
