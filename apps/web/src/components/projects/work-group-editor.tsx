"use client";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Button } from "@/components/ui/button";
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
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type PlannedWorkGroup, updateWorkGroup } from "@/lib/projects";
import { toast } from "@/lib/toast";
export function WorkGroupEditor({
  group,
  onSaved,
}: {
  group: PlannedWorkGroup;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [github, setGithub] = useState(group.github_url ?? "");
  const [demo, setDemo] = useState(group.demo_url ?? "");
  const [devpost, setDevpost] = useState(group.devpost_url ?? "");
  const [timing, setTiming] = useState(group.presentation_timing_preference);
  async function save() {
    setPending(true);
    setError(null);
    try {
      await updateWorkGroup(group.id, {
        name: name.trim(),
        description: description.trim(),
        github_url: github.trim() || null,
        demo_url: demo.trim() || null,
        devpost_url: devpost.trim() || null,
        presentation_timing_preference: group.presentation_timing_editable ? timing : undefined,
      });
      toast.success(t("projectSaved"), { compactTitle: t("toastSaveProject") });
      setOpen(false);
      await onSaved();
    } catch (error) {
      setError(error instanceof ApiError ? error.message : t("couldNotSaveProject"));
    } finally {
      setPending(false);
    }
  }
  return (
    <SidePanelEditor
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <PencilIcon className="size-4" />
          {t("editProject")}
        </Button>
      }
      icon={PencilIcon}
      title={t("editProject")}
      footer={
        <Button disabled={pending || !name.trim()} onClick={save}>
          {t("save")}
        </Button>
      }
    >
      <div className="space-y-4">
        <WorkGroupField
          id="group-name"
          label={t("projectNameLabel")}
          value={name}
          onChange={setName}
        />
        <div className="space-y-2">
          <Label htmlFor="group-description">{t("descriptionLabel")}</Label>
          <Textarea
            id="group-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <WorkGroupField
          id="group-devpost"
          label={t("workGroupDevpostUrl")}
          value={devpost}
          onChange={setDevpost}
          type="url"
        />
        <WorkGroupField
          id="group-github"
          label={t("projectRepoUrlLabel")}
          value={github}
          onChange={setGithub}
          type="url"
        />
        <WorkGroupField
          id="group-demo"
          label={t("projectDemoUrlLabel")}
          value={demo}
          onChange={setDemo}
          type="url"
        />
        <div className="space-y-2">
          <Label htmlFor="group-timing">{t("workGroupTiming")}</Label>
          <Select
            value={timing}
            disabled={!group.presentation_timing_editable}
            onValueChange={(value) => setTiming(value as typeof timing)}
          >
            <SelectTrigger
              id="group-timing"
              aria-describedby={
                !group.presentation_timing_editable ? "group-timing-locked" : undefined
              }
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no_preference">{t("workGroupTimingNone")}</SelectItem>
              <SelectItem value="early">{t("workGroupTimingEarly")}</SelectItem>
              <SelectItem value="middle">{t("workGroupTimingMiddle")}</SelectItem>
              <SelectItem value="late">{t("workGroupTimingLate")}</SelectItem>
            </SelectContent>
          </Select>
          {!group.presentation_timing_editable && (
            <p id="group-timing-locked" className="text-xs text-muted-foreground">
              {t("projectTimingLocked")}
            </p>
          )}
        </div>
      </div>
      {error && <ContextualError message={error} />}
    </SidePanelEditor>
  );
}
export function WorkGroupField({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
