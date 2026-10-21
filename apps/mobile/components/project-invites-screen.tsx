import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { GlassButton } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { type ProjectInvite, projectMutation } from "@/lib/projects";
import { colors, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

/** H19: pending team invitations. A row leaves at once and returns if the server refuses. */
export function ProjectInvitesScreen() {
  const { t } = useLocale();
  const readable = useParticipantLayout("list");
  const [invites, setInvites] = useState<ProjectInvite[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const load = useCallback(async () => {
    try {
      const result = await apiFetch<{ invites: ProjectInvite[] }>("/api/me/projects/invites");
      setInvites(result.invites);
    } catch (cause) {
      setError(cause as Error);
      setInvites((current) => current ?? []);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function answer(invite: ProjectInvite, action: "accept" | "decline") {
    setError(null);
    setInvites((current) => current?.filter((item) => item.id !== invite.id) ?? current);
    try {
      await projectMutation(`/api/me/projects/${invite.projectId}/invites/${action}`, "POST");
      void haptic(action === "accept" ? "success" : "light");
    } catch (cause) {
      setError(cause as Error);
      // Team full, phase closed or already a member: the server list is the truth.
      await load();
    }
  }
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ flexGrow: 1, gap: 16, paddingVertical: 16, ...readable.content }}
      style={{ backgroundColor: colors.background }}
    >
      {error ? <RequestFeedback error={error} /> : null}
      {invites === null ? <RequestFeedback loading /> : null}
      {invites?.length === 0 ? <EmptyState icon="envelope" title={t("projectNoInvites")} /> : null}
      {invites && invites.length > 0 ? (
        <Section>
          {invites.map((invite, index) => (
            <View key={invite.id}>
              {index > 0 ? <Separator /> : null}
              <View style={{ gap: 12, padding: 16 }}>
                <View style={{ gap: 2 }}>
                  <Text
                    style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
                  >
                    {invite.name}
                  </Text>
                  {invite.invitedBy ? (
                    <Text style={{ color: colors.secondaryLabel, fontSize: type.compact.fontSize }}>
                      {t("projectInvitedBy", { name: invite.invitedBy })}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <GlassButton
                    style={{ flex: 1 }}
                    label={t("projectDeclineShort")}
                    onPress={() => void answer(invite, "decline")}
                  />
                  <GlassButton
                    style={{ flex: 1 }}
                    prominent
                    label={t("projectAcceptShort")}
                    onPress={() => void answer(invite, "accept")}
                  />
                </View>
              </View>
            </View>
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}
