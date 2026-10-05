"use client";

import { useId, useState } from "react";
import { ActionGroup } from "@/components/common/action-group";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { DataTable } from "@/components/common/data-table";
import { FormActions } from "@/components/common/form-actions";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { StatusBadge } from "@/components/common/status-badge";
import { TabBar } from "@/components/common/tab-bar";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type MessageKey, useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { toast } from "@/lib/toast";
import { confirmDiscardUnsavedChanges } from "@/lib/use-unsaved-changes-guard";

const queueProjects = [
  "Open Campus",
  "GreenRoutes",
  "LocalLens",
  "AquaSense",
  "AccessMap",
  "CodeGarden",
  "MediBridge",
  "LoopLab",
  "CityPulse",
  "EcoTrack",
  "StudyBuddy",
  "CommonGround",
];

const records = Array.from({ length: 18 }, (_, index) => ({
  id: String(index),
  name: ["Ada Lovelace", "Grace Hopper", "Margaret Hamilton"][index % 3],
  confirmed: index % 3 !== 0,
}));

/** Real shared compositions with synthetic data and reversible interactions. */
export function SurfacesPreview() {
  const { t } = useLocale();
  const [editorOpen, setEditorOpen] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(true);
  const [tab, setTab] = useState("dense");
  const [readingDirty, setReadingDirty] = useState(false);
  const [tabWidth, setTabWidth] = useState<"full" | "content">("full");
  return (
    <SectionCard title={t("surfacePatterns")} variant="plain">
      <p className="type-meta">{t("surfaceGuidance")}</p>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (confirmDiscardUnsavedChanges(readingDirty, t)) {
            setReadingDirty(false);
            setTab(value);
          }
        }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <TabBar width={tabWidth} aria-label={t("surfacePatterns")}>
            <TabsTrigger value="dense">{t("surfaceDense")}</TabsTrigger>
            <TabsTrigger value="reading">{t("surfaceReading")}</TabsTrigger>
            <TabsTrigger value="workspace">{t("surfaceWorkspace")}</TabsTrigger>
          </TabBar>
          <ActionGroup aria-label={t("surfaceTabsWidth")}>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={tabWidth === "full"}
              onClick={() => setTabWidth("full")}
            >
              {t("surfaceTabsFull")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={tabWidth === "content"}
              onClick={() => setTabWidth("content")}
            >
              {t("surfaceTabsContent")}
            </Button>
          </ActionGroup>
        </div>
        <TabsContent value="dense" className="pt-6">
          <PageLayout>
            <PageHeader
              headingLevel={2}
              title={t("users")}
              state={<span className="type-meta tabular-nums">18</span>}
              primaryAction={
                <Button onClick={() => setEditorOpen(true)}>{t("surfaceOpenEditor")}</Button>
              }
            />
            <p className="type-meta">{t("surfaceDenseHelp")}</p>
            <DataTable
              columns={[
                {
                  id: "name",
                  header: t("name"),
                  cell: (row) => row.name,
                  sortValue: (row) => row.name,
                },
                {
                  id: "state",
                  header: t("statusColumn"),
                  cell: (row) => (
                    <StatusBadge tone={row.confirmed ? "success" : "warning"}>
                      {t(row.confirmed ? "confirmed" : "waiting")}
                    </StatusBadge>
                  ),
                },
              ]}
              data={records}
              getRowId={(row) => row.id}
              searchable={(row) => row.name}
              pageSize={6}
              rowActions={() => (
                <Button variant="ghost" size="sm" onClick={() => setEditorOpen(true)}>
                  {t("edit")}
                </Button>
              )}
            />
          </PageLayout>
        </TabsContent>
        <TabsContent value="reading" className="pt-6">
          <p className="type-meta mb-6">{t("surfaceReadingHelp")}</p>
          <ReadingPreview onDirtyChange={setReadingDirty} />
        </TabsContent>
        <TabsContent value="workspace" className="pt-6">
          <p className="type-meta mb-6">{t("surfaceWorkspaceHelp")}</p>
          <WorkspacePreview />
        </TabsContent>
      </Tabs>
      <SectionCard title={t("surfaceOverlays")} variant="plain">
        <p className="type-meta">{t("surfacePanelHelp")}</p>
        <p className="type-meta">{t("surfaceModalHelp")}</p>
        <ActionGroup>
          <Button variant="outline" onClick={() => setEditorOpen(true)}>
            {t("surfaceOpenEditor")}
          </Button>
          <Modal
            size="sm"
            title={t("surfaceDecision")}
            description={t("surfaceDecisionHelp")}
            trigger={<Button variant="outline">{t("surfaceOpenDecision")}</Button>}
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="outline">{t("cancel")}</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>{t("close")}</Button>
                </DialogClose>
              </>
            }
          />
          <AlertModal
            title={t("surfaceDecision")}
            description={t("surfaceDecisionHelp")}
            trigger={<Button variant="outline">{t("surfaceOpenConfirmation")}</Button>}
            cancelLabel={t("cancel")}
            confirmLabel={t("surfaceConfirmDecision")}
            autoClose
            onConfirm={() => setNoticeVisible(false)}
          />
        </ActionGroup>
      </SectionCard>
      <EditorPreview open={editorOpen} onOpenChange={setEditorOpen} />
      <SectionCard variant="plain" title={t("surfaceFeedback")}>
        <p className="type-meta">{t("surfaceFeedbackHelp")}</p>
        <ActionGroup>
          {(["saved", "unsaved", "saving", "error"] as const).map((state) => (
            <SaveStatus key={state} state={state} />
          ))}
        </ActionGroup>
        <p className="type-meta">{t("surfaceToastHelp")}</p>
        {noticeVisible && (
          <p data-preview-notice className="text-sm">
            {t("surfaceDecisionHelp")}
          </p>
        )}
        <Button
          variant="outline"
          disabled={!noticeVisible}
          onClick={() => {
            setNoticeVisible(false);
            toast.success(t("surfacePreviewSaved"), {
              description: t("surfaceDecisionHelp"),
              action: {
                label: t("undo"),
                onClick: () => {
                  setNoticeVisible(true);
                  toast.info(t("surfaceUndoNotice"));
                },
              },
            });
          }}
        >
          {t("surfaceActionToast")}
        </Button>
      </SectionCard>
    </SectionCard>
  );
}

function ReadingPreview({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useLocale();
  const [state, setState] = useState<SaveState>("saved");
  const [fail, setFail] = useState(false);
  const [error, setError] = useState(false);
  function save(event: React.FormEvent) {
    event.preventDefault();
    setState("saving");
    window.setTimeout(() => {
      setState(fail ? "error" : "saved");
      onDirtyChange(fail);
      setError(fail);
      if (!fail) toast.success(t("surfacePreviewSaved"));
    }, 650);
  }
  return (
    <PageLayout width="reading">
      <PageHeader headingLevel={2} title={t("eventSettings")} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fail} onChange={(event) => setFail(event.target.checked)} />
        {t("surfaceSimulateError")}
      </label>
      <form
        onSubmit={save}
        onChange={() => {
          setState("unsaved");
          onDirtyChange(true);
        }}
      >
        <SectionCard
          variant="plain"
          stickyFooter
          footerClassName="justify-start"
          footer={<FormActions pending={state === "saving"} state={state} />}
        >
          <EventFields />
          {error && <ContextualError message={t("surfacePreviewFailed")} />}
        </SectionCard>
      </form>
    </PageLayout>
  );
}

function PreviewField({
  label,
  value = "",
  type = "text",
  multiline = false,
}: {
  label: MessageKey;
  value?: string;
  type?: React.ComponentProps<typeof Input>["type"];
  multiline?: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t(label)}</Label>
      {multiline ? (
        <Textarea id={id} defaultValue={value} rows={4} />
      ) : (
        <Input id={id} type={type} defaultValue={value} />
      )}
    </div>
  );
}

function EditorFields() {
  const { t } = useLocale();
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PreviewField label="surfacePreviewName" value="Open Campus" />
        <PreviewField
          label="surfacePreviewDescription"
          value={t("surfaceProjectSummary")}
          multiline
        />
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <h3 className="type-label sm:col-span-2">{t("surfaceProjectLinks")}</h3>
        <PreviewField
          label="surfaceRepository"
          value="https://github.com/example/open-campus"
          type="url"
        />
        <PreviewField label="surfaceDemo" value="https://open-campus.example.com" type="url" />
      </div>
      <div className="space-y-3">
        <h3 className="type-label">{t("surfaceTeam")}</h3>
        {["Ada Lovelace", "Grace Hopper", "Margaret Hamilton"].map((name) => (
          <div
            key={name}
            className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-3 last:border-0"
          >
            <span className="text-sm">{name}</span>
            <span className="type-meta">{t("confirmed")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventFields() {
  const { t } = useLocale();
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h3 className="type-section-title">{t("surfaceIdentity")}</h3>
        <PreviewField label="name" value="HackUDC 2027" />
        <PreviewField label="taglineLabel" value={t("surfaceTagline")} />
      </div>
      <div className="space-y-4">
        <h3 className="type-section-title">{t("scheduleSectionTitle")}</h3>
        <div className="grid items-start gap-4 sm:grid-cols-2 sm:[&_label]:min-h-9">
          <PreviewField label="eventStartsLabel" type="datetime-local" value="2027-02-26T16:00" />
          <PreviewField label="eventEndsLabel" type="datetime-local" value="2027-02-28T18:00" />
          <PreviewField label="hackingStartsLabel" type="datetime-local" value="2027-02-26T19:00" />
          <PreviewField label="hackingEndsLabel" type="datetime-local" value="2027-02-28T10:00" />
        </div>
      </div>
      <div className="space-y-4">
        <h3 className="type-section-title">{t("venueSectionTitle")}</h3>
        <PreviewField label="venueNameLabel" value="Facultade de Informática da Coruña" />
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <PreviewField label="venueLatitudeLabel" value="43.3328" />
          <PreviewField label="venueLongitudeLabel" value="-8.4109" />
        </div>
      </div>
    </div>
  );
}

function EvaluationFields() {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm font-semibold">Open Campus</p>
        <p className="type-meta">{t("surfaceProjectSummary")}</p>
      </div>
      {["surfaceInnovation", "surfaceExecution", "surfaceImpact"].map((label) => (
        <div key={label} className="space-y-4">
          <PreviewField label={label as MessageKey} type="number" value="7" />
          <PreviewField label="notesLabel" multiline />
        </div>
      ))}
    </div>
  );
}

function WorkspacePreview() {
  const { t } = useLocale();
  const formId = useId();
  const [state, setState] = useState<SaveState>("saved");
  return (
    <div
      data-workspace-preview
      className="grid gap-4 lg:h-120 lg:min-h-0 lg:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)] lg:overflow-hidden"
    >
      <SectionCard
        title={t("surfaceQueue")}
        className="flex min-h-0 flex-col"
        bodyClassName="min-h-0 overflow-y-auto lg:flex-1"
      >
        {queueProjects.map((record) => (
          <div key={record} className="border-b py-3 last:border-0">
            <p className="text-sm font-medium">{record}</p>
            <p className="type-meta">{t("waiting")}</p>
          </div>
        ))}
      </SectionCard>
      <SectionCard
        title={t("surfaceEvaluate")}
        className="flex min-h-0 flex-col"
        bodyClassName="min-h-0 overflow-y-auto lg:flex-1"
        footer={<FormActions pending={state === "saving"} state={state} form={formId} />}
      >
        <form
          id={formId}
          onChange={() => setState("unsaved")}
          onSubmit={(event) => {
            event.preventDefault();
            setState("saving");
            window.setTimeout(() => setState("saved"), 650);
          }}
        >
          <EvaluationFields />
        </form>
      </SectionCard>
    </div>
  );
}

function EditorPreview({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const formId = useId();
  const [state, setState] = useState<SaveState>("saved");
  const [size, setSize] = useState<"default" | "wide" | "expanded">("default");
  function changeOpen(next: boolean) {
    if (state === "saving") return;
    if (!next && !confirmDiscardUnsavedChanges(state === "unsaved", t)) return;
    setState("saved");
    onOpenChange(next);
  }
  return (
    <SidePanelEditor
      open={open}
      onOpenChange={changeOpen}
      title={t("surfaceOpenEditor")}
      description={t("surfaceDecisionHelp")}
      size={size}
      footer={
        <FormActions
          pending={state === "saving"}
          state={state}
          form={formId}
          secondaryActions={
            <Button
              variant="outline"
              disabled={state === "saving"}
              onClick={() => changeOpen(false)}
            >
              {t("cancel")}
            </Button>
          }
        />
      }
    >
      <div className="mb-6 space-y-2">
        <label htmlFor={`${formId}-size`} className="type-label">
          {t("surfaceEditorWidth")}
        </label>
        <Select value={size} onValueChange={(value) => setSize(value as typeof size)}>
          <SelectTrigger id={`${formId}-size`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{t("surfaceCompactEditor")}</SelectItem>
            <SelectItem value="wide">{t("surfaceWideEditor")}</SelectItem>
            <SelectItem value="expanded">{t("surfaceExpandedEditor")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <form
        id={formId}
        onChange={() => setState("unsaved")}
        onSubmit={(event) => {
          event.preventDefault();
          setState("saving");
          window.setTimeout(() => {
            setState("saved");
            toast.success(t("surfacePreviewSaved"));
          }, 650);
        }}
      >
        <div
          className={
            size === "expanded"
              ? "grid items-start gap-6 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
              : undefined
          }
        >
          <EditorFields />
          {size === "expanded" && (
            <aside className="space-y-4 rounded-surface border bg-muted/30 p-4">
              <p className="type-label">{t("surfaceExpandedEditor")}</p>
              <h3 className="type-section-title">Open Campus</h3>
              <p className="text-sm text-muted-foreground">{t("surfaceProjectSummary")}</p>
              <p className="type-meta">Ada Lovelace · Grace Hopper · Margaret Hamilton</p>
            </aside>
          )}
        </div>
      </form>
    </SidePanelEditor>
  );
}
