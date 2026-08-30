import { useScrollToTop } from "expo-router";
import { useRef } from "react";
import { Linking, ScrollView, useColorScheme } from "react-native";

import { ActionButton, Section, Separator } from "@/components/native-ui";
import { EVENT_WEBSITE_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";

/** Privacy and terms links kept out of the account overview. */
export default function LegalScreen() {
  useColorScheme();
  const { t } = useLocale();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);

  useScrollToTop(scrollRef);

  return (
    <ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 20,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
    >
      <Section>
        <ActionButton
          label={t("accountPrivacyPolicy")}
          icon="hand.raised"
          onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/privacy`)}
        />
        <Separator />
        <ActionButton
          label={t("accountTerms")}
          icon="doc.text"
          onPress={() => void Linking.openURL(`${EVENT_WEBSITE_URL}/terms`)}
        />
      </Section>
    </ScrollView>
  );
}
