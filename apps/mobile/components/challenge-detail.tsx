import { Link, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { AdaptiveFrame } from "@/components/adaptive-frame";
import { SheetModal } from "@/components/app-sheet";
import { EntryBackToolbar } from "@/components/header-back-button";
import { EmptyState, FloatingGlassButton, Section, Separator } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type ChallengeDetail, fetchChallengeDetail, type GalleryPage } from "@/lib/projects";
import { useStreamRefresh } from "@/lib/use-stream-refresh";
import { colors, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

function Prose({ text }: { text: string }) {
  return (
    <Text
      selectable
      style={{
        color: colors.label,
        fontSize: type.callout.fontSize,
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
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setError(null);
      try {
        const next = await fetchChallengeDetail(language, id);
        setError(null);
        // A quiet refresh keeps the rendered object when nothing changed.
        setChallenge((current) =>
          quiet && JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      } catch (cause) {
        setError(cause as Error);
      }
    },
    [id, language],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useStreamRefresh(() => void load(true), { publicContent: true });
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
          style={{
            color: colors.label,
            fontSize: type.title.fontSize,
            fontWeight: "700",
            paddingHorizontal: 4,
          }}
        >
          {challenge.title}
        </Text>
      ) : null}
      {company ? (
        <Section>
          <Link href={`/companies/${company.id}`} asChild>
            <PressableFeedback
              feedback="row"
              accessibilityRole="button"
              accessibilityLabel={company.name}
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 12,
                minHeight: 60,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Link.AppleZoom>
                <View>
                  <PersonAvatar
                    size={40}
                    name={company.name}
                    uri={company.logoUrl}
                    kind="sponsor"
                  />
                </View>
              </Link.AppleZoom>
              <Text
                style={{
                  color: colors.label,
                  flex: 1,
                  fontSize: type.body.fontSize,
                  fontWeight: "600",
                }}
              >
                {company.name}
              </Text>
              <SymbolView
                name="chevron.right"
                size={13}
                tintColor={colors.tertiaryLabel}
                accessible={false}
              />
            </PressableFeedback>
          </Link>
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
                  fontSize: type.body.fontSize,
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
  const readable = useParticipantLayout("form");
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
  const body =
    error && !challenge ? (
      <RequestFeedback error={error} onRetry={() => void load()} />
    ) : challenge === undefined ? (
      <RequestFeedback loading />
    ) : challenge === null ? (
      <EmptyState icon="trophy" title={t("challengeNotFound")} />
    ) : (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 24,
          paddingVertical: 16,
          ...readable.content,
          paddingBottom: 32,
        }}
        style={{ backgroundColor: colors.background }}
      >
        {error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null}
        <ChallengeDetailBody challenge={challenge} onOpenProjects={openProjects} />
      </ScrollView>
    );
  return (
    <>
      <EntryBackToolbar fallback="/(tabs)/queue" />
      {body}
    </>
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
  const readable = useParticipantLayout("form");
  const { challenge, error, load } = useChallenge(challengeId);
  return (
    <SheetModal visible animationType="slide" onRequestClose={onClose}>
      <AdaptiveFrame>
        {error && !challenge ? (
          <View style={{ paddingTop: 76 }}>
            <RequestFeedback error={error} onRetry={() => void load()} />
          </View>
        ) : challenge === undefined ? (
          <RequestFeedback loading />
        ) : challenge === null ? (
          <EmptyState icon="trophy" title={t("challengeNotFound")} />
        ) : (
          <ScrollView
            alwaysBounceVertical
            contentContainerStyle={{
              gap: 24,
              paddingVertical: 16,
              ...readable.content,
              paddingBottom: 32,
              paddingTop: 76,
            }}
          >
            {error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null}
            <ChallengeDetailBody challenge={challenge} showTitle />
          </ScrollView>
        )}
        <FloatingGlassButton
          top={16}
          side="right"
          icon="xmark"
          accessibilityLabel={t("close")}
          onPress={onClose}
        />
      </AdaptiveFrame>
    </SheetModal>
  );
}
