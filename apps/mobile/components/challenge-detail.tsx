import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Linking, Modal, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState, FloatingGlassButton, Section, Separator } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type ChallengeDetail, fetchChallengeDetail, type GalleryPage } from "@/lib/projects";
import { colors } from "@/theme/colors";

function Prose({ text }: { text: string }) {
  return (
    <Text
      selectable
      style={{
        color: colors.label,
        fontSize: 16,
        lineHeight: 23,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      {text}
    </Text>
  );
}

function useChallenge(id: number) {
  const { language } = useLocale();
  const [challenge, setChallenge] = useState<ChallengeDetail | null | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setChallenge(await fetchChallengeDetail(language, id));
    } catch (cause) {
      setError(cause as Error);
    }
  }, [id, language]);
  useEffect(() => {
    void load();
  }, [load]);
  return { challenge, error, load };
}

/**
 * H45: a challenge's public brief — what to build, how it is judged, prizes
 * and the company behind it. `onOpenProjects` adds the gallery row when the
 * gallery is open for this challenge (it answers 403 until then).
 */
export function ChallengeDetailBody({
  challenge,
  showTitle = false,
  onOpenProjects,
}: {
  challenge: ChallengeDetail;
  showTitle?: boolean;
  onOpenProjects?: () => void;
}) {
  const { t } = useLocale();
  const [hasProjects, setHasProjects] = useState(false);
  useEffect(() => {
    if (!onOpenProjects) return;
    let live = true;
    void apiFetch<GalleryPage>(
      `/api/public/projects?page=1&pageSize=1&search=&challengeId=${challenge.id}`,
    )
      .then((page) => live && setHasProjects(page.total > 0))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [challenge.id, onOpenProjects]);
  const company = challenge.company;
  return (
    <>
      {showTitle ? (
        <Text
          accessibilityRole="header"
          style={{ color: colors.label, fontSize: 28, fontWeight: "700", paddingHorizontal: 4 }}
        >
          {challenge.title}
        </Text>
      ) : null}
      {company ? (
        <Section>
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              minHeight: 60,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <PersonAvatar size={40} name={company.name} uri={company.logoUrl} kind="sponsor" />
            <Text style={{ color: colors.label, flex: 1, fontSize: 17, fontWeight: "600" }}>
              {company.name}
            </Text>
          </View>
          {company.website ? (
            <>
              <Separator inset={68} />
              <NavRow
                icon="globe"
                title={company.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                onPress={() => void Linking.openURL(company.website as string)}
              />
            </>
          ) : null}
        </Section>
      ) : null}
      {challenge.description ? (
        <Section>
          <Prose text={challenge.description} />
        </Section>
      ) : null}
      {challenge.criteria ? (
        <Section title={t("challengeCriteria")}>
          <Prose text={challenge.criteria} />
        </Section>
      ) : null}
      {challenge.prizes.length ? (
        <Section title={t("challengePrizes")}>
          {challenge.prizes.map((prize, index) => (
            <View key={prize}>
              {index > 0 ? <Separator /> : null}
              <Text
                style={{
                  color: colors.label,
                  fontSize: 17,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                }}
              >
                {prize}
              </Text>
            </View>
          ))}
        </Section>
      ) : null}
      {onOpenProjects && hasProjects ? (
        <Section>
          <NavRow title={t("challengeProjects")} onPress={onOpenProjects} />
        </Section>
      ) : null}
    </>
  );
}

/** Route `/projects/challenge?challengeId=…`, pushed from a project's challenge rows. */
export function ChallengeDetailScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const id = Number(challengeId);
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const { challenge, error, load } = useChallenge(id);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: challenge?.title ?? "",
      headerLargeTitle: true,
      headerLargeTitleShadowVisible: false,
      headerShadowVisible: false,
    });
  }, [navigation, challenge?.title]);
  const openProjects = useCallback(
    () => router.push({ pathname: "/projects/gallery", params: { challengeId: String(id) } }),
    [router, id],
  );
  if (error) return <RequestFeedback error={error} onRetry={() => void load()} />;
  if (challenge === undefined) return <RequestFeedback loading />;
  if (challenge === null) return <EmptyState icon="trophy" title={t("challengeNotFound")} />;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 24, padding: 16, paddingBottom: 32 }}
      style={{ backgroundColor: colors.background }}
    >
      <ChallengeDetailBody challenge={challenge} onOpenProjects={openProjects} />
    </ScrollView>
  );
}

/** The same brief as a sheet over another sheet (a company's card in the diary). */
export function ChallengeSheet({
  challengeId,
  onClose,
}: {
  challengeId: number;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const { challenge, error, load } = useChallenge(challengeId);
  const top = process.env.EXPO_OS === "android" ? insets.top : 0;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        {error ? (
          <View style={{ paddingTop: 76 + top }}>
            <RequestFeedback error={error} onRetry={() => void load()} />
          </View>
        ) : challenge === undefined ? (
          <RequestFeedback loading />
        ) : challenge === null ? (
          <EmptyState icon="trophy" title={t("challengeNotFound")} />
        ) : (
          <ScrollView
            contentContainerStyle={{
              gap: 24,
              padding: 16,
              paddingBottom: 32,
              paddingTop: 76 + top,
            }}
          >
            <ChallengeDetailBody challenge={challenge} showTitle />
          </ScrollView>
        )}
        <FloatingGlassButton
          top={16 + top}
          side="right"
          icon="xmark"
          accessibilityLabel={t("close")}
          onPress={onClose}
        />
      </View>
    </Modal>
  );
}
