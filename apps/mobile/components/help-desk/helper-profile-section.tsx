import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Section, Separator, ToggleRow } from "@/components/native-ui";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import type { DirectoryEntry } from "@/lib/directory";
import { helpMutation, type MyHelperProfile } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useHelpResource } from "@/lib/use-help-resource";

/**
 * H61: the public profile editor's one Help desk row: On/Off is the published
 * state, and it opens the help desk settings page (`app/helper-profile.tsx`).
 * Nothing renders for people who cannot be helpers.
 */
export function HelperSettingsLink() {
  const { t } = useLocale();
  const router = useRouter();
  const result = useHelpResource<MyHelperProfile>("/api/me/helper-profile");
  const profile = result.data;
  if (!profile && result.error) {
    return <RequestFeedback error={result.error} onRetry={() => void result.load()} />;
  }
  if (!profile?.eligible) return null;
  return (
    <Section>
      <NavRow
        icon="lifepreserver"
        title={t("helpDesk")}
        value={t(profile.published ? "helpOn" : "helpOff")}
        onPress={() => router.push("/helper-profile")}
      />
    </Section>
  );
}

/**
 * H61, H62: the help desk part of the public profile editor, shown to eligible
 * helpers below their profile card (which supplies the bio and identity): an
 * "Available to mentor" switch (publication) and a row into the mentor profile
 * (knowledge areas and hours). Publishing without knowledge opens the mentor
 * profile instead, since a published helper needs at least one area.
 */
export function HelperProfileSection({
  onProfileChange,
}: {
  onProfileChange?: (profile: MyHelperProfile<DirectoryEntry>) => void;
} = {}) {
  const { t } = useLocale();
  const router = useRouter();
  const [profile, setProfile] = useState<MyHelperProfile<DirectoryEntry> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProfile(await apiFetch<MyHelperProfile<DirectoryEntry>>("/api/me/helper-profile"));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, []);
  // Reload on focus: the mentor profile screen above this one changes the data.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (profile) onProfileChange?.(profile);
  }, [profile, onProfileChange]);

  async function publish(published: boolean) {
    if (!profile || busy) return;
    if (published && profile.topics.length === 0) {
      router.push("/helper-mentor");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setProfile(
        await helpMutation<MyHelperProfile<DirectoryEntry>>(
          "/api/me/helper-profile",
          {
            published,
            topicIds: profile.topics.map((topic) => topic.id),
            ownChallengesOnly: profile.ownChallengesOnly,
          },
          "PUT",
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  }

  if (!profile?.eligible) {
    return error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null;
  }
  return (
    <>
      <Section>
        <ToggleRow
          label={t("helpMentorAvailable")}
          value={profile.published}
          disabled={busy}
          onChange={(value) => void publish(value)}
        />
        <Separator inset={16} />
        <NavRow
          title={t("helpMentorProfile")}
          value={profile.topics.length > 0 ? String(profile.topics.length) : undefined}
          onPress={() => router.push("/helper-mentor")}
        />
      </Section>
      {error ? <RequestFeedback error={error} message={error.message} /> : null}
    </>
  );
}
