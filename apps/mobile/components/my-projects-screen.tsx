import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ActionButton, EmptyState, InfoRow, Section, Separator } from "@/components/native-ui";
import { ProjectEditor } from "@/components/project-detail-screen";
import { ProjectGalleryConsent } from "@/components/project-gallery-consent";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ApiError, apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type NativeProject, projectMutation } from "@/lib/projects";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { colors } from "@/theme/colors";

/** H19/H20: one personal destination for drafts, invitations and live queue. */
export function MyProjectsScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const trueTop = useTrueTopScroll(scrollRef);
  const [projects, setProjects] = useState<NativeProject[] | null>(null);
  const [invites, setInvites] = useState<{ id: number; projectId: number; name: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const load = useCallback(async () => {
    const [mine, invitations] = await Promise.allSettled([
      apiFetch<{ projects: NativeProject[]; canCreate: boolean }>("/api/me/projects"),
      apiFetch<{ invites: { id: number; projectId: number; name: string }[] }>(
        "/api/me/projects/invites",
      ),
    ]);
    // A failed invitation read must not hide the participant's own projects.
    setInvites(invitations.status === "fulfilled" ? invitations.value.invites : []);
    if (mine.status === "fulfilled") {
      setProjects(mine.value.projects);
      setCanCreate(mine.value.canCreate);
      setError(invitations.status === "rejected" ? (invitations.reason as Error) : null);
    } else {
      setProjects((current) => current ?? []);
      setCanCreate(false);
      setError(mine.reason as Error);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      await load();
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      ref={scrollRef}
      {...trueTop.scrollProps}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 120 }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: colors.label, fontSize: 28, fontWeight: "800" }}
      >
        {t("projects")}
      </Text>
      {error ? (
        <RequestFeedback
          error={error}
          onRetry={
            error instanceof ApiError && error.status === 403 ? undefined : () => void load()
          }
        />
      ) : null}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <ActionButton label={t("gallery")} onPress={() => router.push("/projects/gallery")} />
        <ActionButton label={t("projectQueue")} onPress={() => router.push("/projects/queue")} />
      </View>
      {projects === null && !error ? <RequestFeedback loading /> : null}
      {projects?.length === 0 && !error ? (
        <EmptyState icon="hammer" title={t("projectNoProjects")} />
      ) : null}
      {projects?.length === 1 ? (
        <ProjectEditor
          key={`${projects[0].id}:${projects[0].revision}`}
          project={projects[0]}
          reload={load}
          embedded
        />
      ) : (
        projects &&
        projects.length > 1 && (
          <Section>
            {projects.map((project, index) => (
              <View key={project.id}>
                {index > 0 ? <Separator /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={project.name}
                  onPress={() => router.push(`/projects/${project.id}`)}
                >
                  <InfoRow
                    label={project.name}
                    value={t(
                      project.submissionStatus === "submitted"
                        ? "projectSubmitted"
                        : "projectDraft",
                    )}
                    accessoryIcon="chevron.right"
                  />
                </Pressable>
              </View>
            ))}
          </Section>
        )
      )}
      {invites.map((project) => (
        <Section key={project.projectId} title={project.name}>
          <View style={{ gap: 8, padding: 16 }}>
            <ActionButton
              label={t("projectAccept")}
              busy={busy}
              onPress={() =>
                void mutate(() =>
                  projectMutation(`/api/me/projects/${project.projectId}/invites/accept`, "POST"),
                )
              }
            />
            <ActionButton
              label={t("projectDecline")}
              disabled={busy}
              onPress={() =>
                void mutate(() =>
                  projectMutation(`/api/me/projects/${project.projectId}/invites/decline`, "POST"),
                )
              }
            />
          </View>
        </Section>
      ))}
      {canCreate && projects && projects.length > 0 && !showCreate ? (
        <ActionButton label={t("createProject")} onPress={() => setShowCreate(true)} />
      ) : null}
      {canCreate && (projects?.length === 0 || showCreate) ? (
        <Section title={t("createProject")}>
          <View style={{ padding: 16, gap: 12 }}>
            <TextInput
              accessibilityLabel={t("projectName")}
              placeholder={t("projectName")}
              placeholderTextColor={colors.tertiaryLabel}
              value={name}
              editable={!busy}
              onChangeText={setName}
              style={{ color: colors.label, fontSize: 17, minHeight: 44 }}
            />
            <ActionButton
              label={t("createProject")}
              disabled={!name.trim()}
              busy={busy}
              onPress={() =>
                void mutate(async () => {
                  const created = await projectMutation<NativeProject>("/api/me/projects", "POST", {
                    name: name.trim(),
                  });
                  setName("");
                  router.push(`/projects/${created.id}`);
                })
              }
            />
          </View>
        </Section>
      ) : null}
      <ProjectGalleryConsent />
    </ScrollView>
  );
}
