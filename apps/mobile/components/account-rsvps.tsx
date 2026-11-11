import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text } from "react-native";
import { ActionButton, Section } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { RsvpFields } from "@/components/rsvp-fields";
import { useLocale } from "@/lib/i18n";
import { useRsvps } from "@/lib/rsvps";
import { colors, space, type } from "@/theme";

export function AccountRsvps({
  userId,
  offline,
  onSaved,
}: {
  userId: number;
  offline: boolean;
  onSaved: () => unknown;
}) {
  const { t } = useLocale();
  const rsvps = useRsvps(userId);
  const load = rsvps.load;
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function save() {
    if (offline || saving) return;
    setSaving(true);
    setError(null);
    try {
      await rsvps.save();
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(t("couldNotSaveRsvps")));
      void load();
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      {!rsvps.data ? (
        <RequestFeedback loading={rsvps.loading} error={rsvps.error} onRetry={() => void load()} />
      ) : null}
      {rsvps.data && !rsvps.items.length ? (
        <Section title={t("profileRsvpTitle")}>
          <Text
            selectable
            style={{
              color: colors.secondaryLabel,
              fontSize: type.body.fontSize,
              padding: space.lg,
            }}
          >
            {t("rsvpNoItems")}
          </Text>
        </Section>
      ) : null}
      <RsvpFields
        items={rsvps.items}
        draft={rsvps.draft}
        disabled={offline || saving}
        onChange={(id, answer) => rsvps.setDraft((draft) => ({ ...draft, [id]: answer }))}
      />
      {error ? <RequestFeedback error={error} message={t("couldNotSaveRsvps")} /> : null}
      {rsvps.changed ? (
        <ActionButton
          label={t("save")}
          busy={saving}
          disabled={offline}
          onPress={() => void save()}
        />
      ) : null}
    </>
  );
}
