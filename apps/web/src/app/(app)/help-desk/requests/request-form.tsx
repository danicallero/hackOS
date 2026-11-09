"use client";
import { useEffect, useId, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { SwitchRow } from "@/components/profile/public-profile-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { HelpChallengeOption, HelpRequest, HelpTopic } from "../model";
import { HelpdeskError, TopicsPicker } from "../shared";
/** Creates a request, or with `request` edits an open one (it moves to the end of the queue). */
export function RequestForm({
  onSaved,
  request,
  onDirtyChange,
  onPendingChange,
}: {
  onSaved: () => void;
  request?: HelpRequest;
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [project, setProject] = useState(request?.project ? String(request.project.id) : "self");
  const [topics, setTopics] = useState<HelpTopic[]>(request?.topics ?? []);
  const [other, setOther] = useState(request?.other ?? false);
  const [challenge, setChallenge] = useState(
    request?.challenge ? String(request.challenge.id) : "none",
  );
  const [preferSponsor, setPreferSponsor] = useState(request?.preferSponsor ?? false);
  const [description, setDescription] = useState(request?.description ?? "");
  const [location, setLocation] = useState(request?.location ?? "");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const projects = useServerResource(["helpdesk", "projects"], (signal) =>
    api.get<{ projects: { id: number; name: string }[] }>("/api/helpdesk/projects", { signal }),
  );
  const challenges = useServerResource(["helpdesk", "challenges"], (signal) =>
    api.get<{ challenges: HelpChallengeOption[] }>("/api/helpdesk/challenges", {
      signal,
    }),
  );
  const dirty = request
    ? description !== request.description ||
      location !== request.location ||
      other !== request.other ||
      preferSponsor !== request.preferSponsor ||
      challenge !== (request.challenge ? String(request.challenge.id) : "none") ||
      topics.map((topic) => topic.id).join(",") !==
        request.topics.map((topic) => topic.id).join(",")
    : !!description ||
      !!location ||
      topics.length > 0 ||
      other ||
      challenge !== "none" ||
      preferSponsor ||
      project !== "self";
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  useEffect(
    () => () => {
      onDirtyChange?.(false);
      onPendingChange?.(false);
    },
    [onDirtyChange, onPendingChange],
  );
  const mine = challenges.data?.challenges.filter((item) => item.mine) ?? [];
  const rest = challenges.data?.challenges.filter((item) => !item.mine) ?? [];
  async function save() {
    setPending(true);
    setError(null);
    try {
      const body = {
        topicIds: topics.map((topic) => topic.id),
        other,
        challengeId: challenge === "none" ? null : Number(challenge),
        preferSponsor,
        description: description.trim(),
        location: location.trim(),
      };
      if (request) await api.patch(`/api/helpdesk/requests/${request.id}`, body);
      else
        await api.post("/api/helpdesk/requests", {
          projectId: project === "self" ? null : Number(project),
          ...body,
        });
      setConfirming(false);
      onSaved();
    } catch (err) {
      setConfirming(false);
      setError(err);
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || (request && !dirty)) return;
        if (!topics.length && !other) {
          setInvalid(true);
          return;
        }
        if (request) setConfirming(true);
        else void save();
      }}
    >
      <fieldset className="space-y-5" disabled={pending}>
        {request ? null : (
          <div className="space-y-2">
            <Label htmlFor={`${id}-for`}>{t("helpDeskFor")}</Label>
            <Select
              value={project}
              onValueChange={setProject}
              disabled={pending || projects.loading}
            >
              <SelectTrigger id={`${id}-for`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="self">{t("helpDeskMyself")}</SelectItem>
                {projects.data?.projects.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {projects.error ? <HelpdeskError error={projects.error} retry={projects.reload} /> : null}
        <div className="space-y-2">
          <Label htmlFor={`${id}-topics`}>{t("helpDeskTopics")}</Label>
          <TopicsPicker
            inDialog
            id={`${id}-topics`}
            value={topics}
            onChange={setTopics}
            other={{ value: other, onChange: setOther }}
            disabled={pending}
          />
          {topics.length > 5 ? (
            <p role="alert" className="text-destructive text-sm">
              {t("helpDeskMaxTopics")}
            </p>
          ) : null}
          {invalid && !topics.length && !other ? (
            <p role="alert" className="text-destructive text-sm">
              {t("helpDeskTopicsRequired")}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-challenge`}>{t("helpDeskChallenge")}</Label>
          <Select
            value={challenge}
            onValueChange={(value) => {
              setChallenge(value);
              if (value === "none") setPreferSponsor(false);
            }}
            disabled={pending || challenges.loading}
          >
            <SelectTrigger id={`${id}-challenge`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("helpDeskNoChallenge")}</SelectItem>
              {mine.length ? (
                <SelectGroup>
                  <SelectLabel>{t("helpDeskMyChallenges")}</SelectLabel>
                  {mine.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              {rest.length ? (
                <SelectGroup>
                  {mine.length ? <SelectLabel>{t("helpDeskAllChallenges")}</SelectLabel> : null}
                  {rest.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
          {challenges.error ? (
            <HelpdeskError error={challenges.error} retry={challenges.reload} />
          ) : null}
        </div>
        <SwitchRow
          checked={preferSponsor && challenge !== "none"}
          disabled={pending || challenge === "none"}
          onChange={setPreferSponsor}
          label={t("helpDeskPreferSponsor")}
          hint={t("helpDeskPreferSponsorHint")}
        />
        <div className="space-y-2">
          <Label htmlFor={`${id}-description`}>{t("helpDeskDescription")}</Label>
          <Textarea
            id={`${id}-description`}
            required
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-location`}>{t("helpDeskLocation")}</Label>
          <Input
            id={`${id}-location`}
            required
            maxLength={120}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </div>
      </fieldset>
      {error ? <HelpdeskError error={error} fallback="helpDeskSaveError" /> : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          loading={pending}
          disabled={(!!request && !dirty) || topics.length > 5}
        >
          {t(request ? "saveChanges" : "helpDeskSend")}
        </Button>
      </div>
      <AlertModal
        open={confirming}
        onOpenChange={setConfirming}
        title={t("helpDeskEdit")}
        description={t("helpDeskEditConfirm")}
        cancelLabel={t("cancel")}
        confirmLabel={t("helpDeskEditAndMove")}
        pending={pending}
        onConfirm={() => void save()}
      />
    </form>
  );
}
