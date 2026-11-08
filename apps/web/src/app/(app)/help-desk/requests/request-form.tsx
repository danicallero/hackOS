"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { HelpTopic } from "../model";
import { HelpdeskError, TopicsPicker } from "../shared";
export function RequestForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useLocale();
  const id = useId();
  const [project, setProject] = useState("self");
  const [topics, setTopics] = useState<HelpTopic[]>([]);
  const [other, setOther] = useState(false);
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const projects = useServerResource(["helpdesk", "projects"], (signal) =>
    api.get<{ projects: { id: number; name: string }[] }>("/api/helpdesk/projects", { signal }),
  );
  return (
    <form
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!topics.length && !other) {
          setInvalid(true);
          return;
        }
        setPending(true);
        setError(null);
        try {
          await api.post("/api/helpdesk/requests", {
            projectId: project === "self" ? null : Number(project),
            topicIds: topics.map((topic) => topic.id),
            other,
            description: description.trim(),
            location: location.trim(),
          });
          onSaved();
        } catch (err) {
          setError(err);
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset className="space-y-5" disabled={pending}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-for`}>{t("helpDeskFor")}</Label>
          <Select value={project} onValueChange={setProject} disabled={pending || projects.loading}>
            <SelectTrigger id={`${id}-for`}>
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
        {projects.error ? <HelpdeskError error={projects.error} retry={projects.reload} /> : null}
        <div className="space-y-2">
          <Label htmlFor={`${id}-topics`}>{t("helpDeskTopics")}</Label>
          <TopicsPicker
            inDialog
            id={`${id}-topics`}
            value={topics}
            onChange={setTopics}
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
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${id}-other`}
            checked={other}
            onCheckedChange={(value) => setOther(value === true)}
          />
          <Label htmlFor={`${id}-other`}>{t("helpDeskOther")}</Label>
        </div>
        <p className="text-muted-foreground text-sm text-pretty">{t("helpDeskRoutingNote")}</p>
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
        <Button type="submit" loading={pending} disabled={topics.length > 5}>
          {t("helpDeskSend")}
        </Button>
      </div>
    </form>
  );
}
