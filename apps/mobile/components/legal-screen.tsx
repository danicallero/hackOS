import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Linking, ScrollView, useColorScheme } from "react-native";

import { ActionButton, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { EVENT_WEBSITE_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { useParticipantLayout } from "@/theme/layout-participant";

/** Privacy, terms and open-source licenses, kept out of the account overview. */
export default function LegalScreen() {
  const readable = useParticipantLayout("form");
  useColorScheme();
  const { t } = useLocale();
  const router = useRouter();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);

  const [linkError, setLinkError] = useState<Error | null>(null);
  const [retryUrl, setRetryUrl] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  async function open(url: string) {
    if (opening) return;
    setOpening(true);
    setRetryUrl(url);
    try {
      await Linking.openURL(url);
      setLinkError(null);
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setOpening(false);
    }
  }
  const trueTop = useTrueTopScroll(scrollRef);

  return (
    <ScrollView
      ref={scrollRef}
      {...trueTop.scrollProps}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 20,
        paddingVertical: 16,
        ...readable.content,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
    >
      {linkError ? (
        <RequestFeedback
          error={linkError}
          onRetry={retryUrl ? () => void open(retryUrl) : undefined}
          retrying={opening}
        />
      ) : null}
      <Section>
        <ActionButton
          label={t("accountPrivacyPolicy")}
          icon="hand.raised"
          onPress={() => void open(`${EVENT_WEBSITE_URL}/privacy`)}
        />
        <Separator />
        <ActionButton
          label={t("accountTerms")}
          icon="doc.text"
          onPress={() => void open(`${EVENT_WEBSITE_URL}/terms`)}
        />
        <Separator />
        <ActionButton
          label={t("legalLicenses")}
          icon="books.vertical"
          onPress={() => router.push("/(tabs)/others/licenses")}
        />
      </Section>
    </ScrollView>
  );
}
