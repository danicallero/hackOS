import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Section, ToggleRow } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { projectMutation } from "@/lib/projects";
import { colors } from "@/theme/colors";

/** H18: gallery consent is separate from directory visibility. */
export function ProjectGalleryConsent() {
  const { t } = useLocale();
  const [consent, setConsent] = useState<{ showName: boolean; showPhoto: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    void apiFetch<{ showName: boolean; showPhoto: boolean }>("/api/me/project-gallery-consent")
      .then(setConsent)
      .catch((cause) => setError(cause as Error));
  }, []);
  async function change(next: { showName: boolean; showPhoto: boolean }) {
    setBusy(true);
    setError(null);
    try {
      setConsent(await projectMutation("/api/me/project-gallery-consent", "PUT", next));
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title={t("gallery")}>
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
          {t("projectConsentPolicy")}
        </Text>
        {consent ? (
          <ToggleRow
            label={t("projectPhotoConsent")}
            value={consent.showPhoto}
            busy={busy}
            onChange={(showPhoto) => void change({ showName: true, showPhoto })}
          />
        ) : null}
        {error ? <RequestFeedback error={error} /> : null}
      </View>
    </Section>
  );
}
