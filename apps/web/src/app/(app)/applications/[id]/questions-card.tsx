"use client";

// Question builder (H11): sections and the fields nested inside them, with
// drag-and-drop reordering (dnd-kit) mirroring the up/down buttons — drag is
// the fast path, the buttons are the keyboard-reliable fallback.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { RESERVED_FIELD_KEYS } from "@hackos/shared/applications";
import type { I18nText } from "@hackos/shared/questions";
import {
  AlignLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  ChevronDownIcon,
  CircleDotIcon,
  CopyIcon,
  EyeIcon,
  GraduationCapIcon,
  HashIcon,
  ListChecksIcon,
  type LucideIcon,
  MoreVerticalIcon,
  PaperclipIcon,
  PlusIcon,
  SquareCheckIcon,
  Trash2Icon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Surface } from "@/components/ui/surface";
import { Switch } from "@/components/ui/switch";
import { useShirtSizes } from "@/hooks/use-shirt-sizes";
import { ApiError, api } from "@/lib/api";
import { type MessageKey, type Translate, useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import type { Language } from "@/lib/types";
import {
  type ApplicationForm,
  FIELD_KINDS,
  FILE_KIND,
  type FieldKind,
  type FieldValidation,
  type FormSection,
  OPTION_KINDS,
  type TemplateField,
} from "../lib";
import { generatedFieldKey } from "../workflow";
import { AnswerPreviewControl, FieldPreviewRow, FormPreviewModal } from "./form-preview";
import {
  DragHandle,
  DroppableBlock,
  EmptyBlockHint,
  SortableField,
  SortableSection,
} from "./questions-dnd";
import {
  EMPTY_I18N,
  type IntoleranceOption,
  LOCALES,
  logisticsPreviewFields,
  withLogisticsSection,
} from "./shared";

/** A field/section with a stable client-only identity for drag reordering —
 *  `key` can transiently collide while editing (auto-generated from the
 *  label), so it isn't safe as a dnd-kit sortable id. Never sent to the API. */
interface EditableField extends TemplateField {
  _id: string;
}
interface EditableSection extends FormSection {
  _id: string;
}

/** Copy for each `RESERVED_FIELD_KEYS` entry (H11/H12) — new reserved keys
 *  need an entry here, alongside the i18n message it points to. */
const RESERVED_KEY_DESC: Record<string, MessageKey> = {
  dni: "reservedKeyDni",
};

function mkId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function withIds<T>(items: T[]): (T & { _id: string })[] {
  return items.map((item) => ({ ...item, _id: mkId() }));
}

export function newField(index: number): EditableField {
  return {
    _id: mkId(),
    key: `field_${index + 1}`,
    label: { ...EMPTY_I18N },
    kind: "text",
    required: false,
    retention_mode: "none",
  };
}

export function newSection(index: number): EditableSection {
  return {
    _id: mkId(),
    key: `section_${index + 1}`,
    title: { ...EMPTY_I18N },
  };
}

/** One visual block: a section and its member fields, or the "no section"
 *  bucket (`section: null`). Ungrouped always renders first. */
interface Block {
  id: string;
  section: EditableSection | null;
  fields: EditableField[];
}

function buildBlocks(fields: EditableField[], sections: EditableSection[]): Block[] {
  const knownKeys = new Set(sections.map((s) => s.key));
  const ungrouped = fields.filter((f) => !f.section_key || !knownKeys.has(f.section_key));
  const blocks: Block[] = [{ id: "ungrouped", section: null, fields: ungrouped }];
  for (const s of sections) {
    blocks.push({
      id: `section:${s.key}`,
      section: s,
      fields: fields.filter((f) => f.section_key === s.key),
    });
  }
  return blocks;
}

function isContainerId(id: string): boolean {
  return id === "ungrouped" || id.startsWith("section:");
}

function blockIdForField(field: EditableField, sections: EditableSection[]): string {
  return field.section_key && sections.some((s) => s.key === field.section_key)
    ? `section:${field.section_key}`
    : "ungrouped";
}

export function QuestionsCard({
  form,
  onSaved,
  onDirtyChange,
}: {
  form: ApplicationForm;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, language } = useLocale();
  const [fields, setFields] = useState<EditableField[]>(() => withIds(form.template));
  const [sections, setSections] = useState<EditableSection[]>(() => withIds(form.sections));
  // Only the question you're editing expands into the full editor; every
  // other question just shows its live preview.
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  // Only true while a question is being dragged, so the "drop here" empty
  // placeholder only shows up during a drag instead of sitting there always.
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [missingReservedKeys, setMissingReservedKeys] = useState<string[] | null>(null);
  const [intolerances, setIntolerances] = useState<IntoleranceOption[]>([]);
  const shirtSizes = useShirtSizes();
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Re-seed if the form reloads (e.g. after a metadata save).
  useEffect(() => {
    if (saveState !== "saved") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resyncing local editable state to the just-saved server snapshot
    setFields(withIds(form.template));
    setSections(withIds(form.sections));
  }, [form.template, form.sections, saveState]);

  // The dictionary backing the dietary-restrictions preview options, so the
  // preview matches what an applicant will actually pick from (H12).
  useEffect(() => {
    api
      .get<{ intolerances: IntoleranceOption[] }>("/api/public/food-intolerances")
      .then((r) => setIntolerances(r.intolerances))
      .catch(() => setIntolerances([]));
  }, []);

  useEffect(() => {
    onDirtyChange?.(saveState !== "saved");
  }, [saveState, onDirtyChange]);

  // What the applicant actually sees: custom questions plus whatever
  // shirt-size/dietary fields Form settings' logistics toggles add at submit
  // (mirrors the server's enrichTemplate — H12). Previewing only `fields`
  // would silently hide the very fields those toggles turn on. Those synthetic
  // fields are tagged with the reserved Logistics section, so they group under
  // their own header instead of dangling as ungrouped fields.
  const hasLogisticsFields = form.ask_shirt_size || form.ask_food_intolerances;
  const previewFields = [
    ...fields,
    ...logisticsPreviewFields(
      form.ask_shirt_size,
      form.ask_food_intolerances,
      intolerances,
      shirtSizes,
    ),
  ];
  const previewSections = withLogisticsSection(sections, hasLogisticsFields);

  const blocks = buildBlocks(fields, sections);
  const ungroupedBlock = blocks[0];

  const update = (id: string, patch: Partial<TemplateField>) =>
    setFields((prev) => prev.map((f) => (f._id === id ? { ...f, ...patch } : f)));

  const updateUnsaved = (id: string, patch: Partial<TemplateField>) => {
    setSaveState("unsaved");
    update(id, patch);
  };

  const moveWithinBlock = (id: string, dir: -1 | 1) =>
    setFields((prev) => {
      const field = prev.find((f) => f._id === id);
      if (!field) return prev;
      const blockId = blockIdForField(field, sections);
      const siblingIds = prev
        .filter((f) => blockIdForField(f, sections) === blockId)
        .map((f) => f._id);
      const posInBlock = siblingIds.indexOf(id);
      const targetPos = posInBlock + dir;
      if (targetPos < 0 || targetPos >= siblingIds.length) return prev;
      const otherId = siblingIds[targetPos];
      const i = prev.findIndex((f) => f._id === id);
      const j = prev.findIndex((f) => f._id === otherId);
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      setSaveState("unsaved");
      return next;
    });

  const remove = (id: string) => {
    setSaveState("unsaved");
    setFields((prev) => prev.filter((f) => f._id !== id));
    setActiveFieldId((prev) => (prev === id ? null : prev));
  };

  const add = () => {
    setSaveState("unsaved");
    const field = newField(fields.length);
    setFields((prev) => [...prev, field]);
    setActiveFieldId(field._id);
  };

  const addToSection = (sectionKey: string) => {
    setSaveState("unsaved");
    const field = { ...newField(fields.length), section_key: sectionKey };
    setFields((prev) => [...prev, field]);
    setActiveFieldId(field._id);
  };

  const duplicateField = (id: string) => {
    setSaveState("unsaved");
    setFields((prev) => {
      const i = prev.findIndex((f) => f._id === id);
      if (i === -1) return prev;
      const original = prev[i];
      const copy: EditableField = {
        ...original,
        _id: mkId(),
        retention_mode: "none",
        anonymous_audit_dimension: undefined,
        key: generatedFieldKey(
          `${original.label[language] || original.key}_copy`,
          prev.map((f) => f.key),
        ),
      };
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      setActiveFieldId(copy._id);
      return next;
    });
  };

  const updateSection = (id: string, patch: Partial<FormSection>) => {
    setSaveState("unsaved");
    setSections((prev) => prev.map((s) => (s._id === id ? { ...s, ...patch } : s)));
  };

  const moveSection = (id: string, dir: -1 | 1) =>
    setSections((prev) => {
      const i = prev.findIndex((s) => s._id === id);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      setSaveState("unsaved");
      return next;
    });

  const removeSection = (id: string) => {
    setSaveState("unsaved");
    const removedKey = sections.find((s) => s._id === id)?.key;
    setSections((prev) => prev.filter((s) => s._id !== id));
    // Unassign fields that pointed at the removed section instead of leaving
    // a dangling section_key.
    setFields((prev) =>
      prev.map((f) => (f.section_key === removedKey ? { ...f, section_key: undefined } : f)),
    );
  };

  const addSection = () => {
    setSaveState("unsaved");
    setSections((prev) => [...prev, newSection(prev.length)]);
  };

  const setKind = (id: string, kind: FieldKind) => {
    const field = fields.find((f) => f._id === id);
    updateUnsaved(id, {
      kind,
      // Options only exist for select/multiselect; seed one when switching in.
      options: OPTION_KINDS.includes(kind)
        ? field?.options?.length
          ? field.options
          : [{ value: "", label: { ...EMPTY_I18N } }]
        : undefined,
    });
  };

  function handleFieldDragEnd(activeId: string, overId: string) {
    setFields((prev) => {
      const activeField = prev.find((f) => f._id === activeId);
      if (!activeField) return prev;

      let destBlockId: string;
      let overFieldId: string | null = null;
      if (isContainerId(overId)) {
        destBlockId = overId;
      } else {
        const overField = prev.find((f) => f._id === overId);
        if (!overField) return prev;
        destBlockId = blockIdForField(overField, sections);
        overFieldId = overId;
      }

      const destSectionKey =
        destBlockId === "ungrouped" ? undefined : destBlockId.slice("section:".length);
      const movedField: EditableField =
        activeField.section_key === destSectionKey
          ? activeField
          : { ...activeField, section_key: destSectionKey };

      const withoutActive = prev.filter((f) => f._id !== activeId);
      if (!overFieldId) return [...withoutActive, movedField];
      const insertAt = withoutActive.findIndex((f) => f._id === overFieldId);
      const next = [...withoutActive];
      next.splice(insertAt === -1 ? next.length : insertAt, 0, movedField);
      return next;
    });
    setSaveState("unsaved");
  }

  function handleSectionDragEnd(activeId: string, overId: string) {
    setSections((prev) => {
      const oldIndex = prev.findIndex((s) => s._id === activeId);
      if (oldIndex === -1) return prev;
      // Dropped past the last section — nothing below it to register as
      // `over`, so this dedicated trailing zone stands in for "move to end".
      if (overId === "sections-end") return arrayMove(prev, oldIndex, prev.length - 1);
      const newIndex = prev.findIndex((s) => s._id === overId);
      if (newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    setSaveState("unsaved");
  }

  function handleDragStart() {
    setDragging(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(false);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    const type = active.data.current?.type;
    if (type === "section") handleSectionDragEnd(activeId, overId);
    else if (type === "field") handleFieldDragEnd(activeId, overId);
  }

  function validate(): string | null {
    const sectionSeen = new Set<string>();
    for (const s of sections) {
      if (!s.key.trim()) return t("everySectionNeedsKey");
      if (!/^[a-zA-Z0-9_.-]+$/.test(s.key))
        return t("sectionKeyMustBeAlphanumeric", { key: s.key });
      if (sectionSeen.has(s.key)) return t("duplicateSectionKey", { key: s.key });
      sectionSeen.add(s.key);
    }
    const seen = new Set<string>();
    for (const f of fields) {
      if (!f.key.trim()) return t("everyQuestionNeedsKey");
      if (!/^[a-zA-Z0-9_.-]+$/.test(f.key)) return t("keyMustBeAlphanumeric", { key: f.key });
      if (seen.has(f.key)) return t("duplicateKey", { key: f.key });
      seen.add(f.key);
      if (f.section_key && !sectionSeen.has(f.section_key)) {
        return t("fieldReferencesMissingSection", { key: f.key });
      }
      if (OPTION_KINDS.includes(f.kind)) {
        const opts = f.options ?? [];
        if (opts.length === 0) return t("needsAtLeastOneOption", { key: f.key });
        const optSeen = new Set<string>();
        for (const o of opts) {
          if (!o.value.trim()) return t("optionWithNoValue", { key: f.key });
          if (optSeen.has(o.value)) return t("duplicateOption", { key: f.key, value: o.value });
          optSeen.add(o.value);
        }
      }
    }
    return null;
  }

  function hasI18nText(v: I18nText | undefined): v is I18nText {
    return !!v && Object.values(v).some((s) => s.trim());
  }

  function save() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    // Nudge (not block) toward wiring up the reserved profile-autofill keys
    // (H11/H12) — a form missing them still works, it just won't sync DNI etc.
    // with the applicant's profile, so this is skippable.
    const presentKeys = new Set(fields.map((f) => f.key.trim().toLowerCase()));
    const missing = RESERVED_FIELD_KEYS.map((r) => r.key).filter((k) => !presentKeys.has(k));
    if (missing.length > 0) {
      setMissingReservedKeys(missing);
      return;
    }
    void doSave();
  }

  async function doSave() {
    setMissingReservedKeys(null);
    setSaving(true);
    setSaveState("saving");
    try {
      // PATCH /api/applications/:id { template, sections } (APPLICATIONS_MANAGE).
      // The server re-validates with templateSchema/sectionsSchema (unique
      // keys, option kinds, every field.section_key resolves to a section).
      await api.patch<ApplicationForm>(`/api/applications/${form.id}`, {
        template: fields.map((f) => ({
          key: f.key.trim(),
          label: f.label,
          kind: f.kind,
          required: f.required,
          ...(OPTION_KINDS.includes(f.kind) ? { options: f.options } : {}),
          ...(f.kind === FILE_KIND
            ? {
                ...(f.allowed_file_types?.length
                  ? { allowed_file_types: f.allowed_file_types }
                  : {}),
                ...(f.max_file_size_mb ? { max_file_size_mb: f.max_file_size_mb } : {}),
                ...(f.shareable_with_sponsors ? { shareable_with_sponsors: true } : {}),
              }
            : {}),
          ...(f.section_key ? { section_key: f.section_key } : {}),
          ...(hasI18nText(f.help_text) ? { help_text: f.help_text } : {}),
          ...(hasI18nText(f.placeholder) ? { placeholder: f.placeholder } : {}),
          ...(f.validation && VALIDATABLE_KINDS.has(f.kind) ? { validation: f.validation } : {}),
          retention_mode: f.retention_mode ?? "none",
          ...(f.retention_mode === "anonymous_audit" && f.anonymous_audit_dimension
            ? { anonymous_audit_dimension: f.anonymous_audit_dimension.trim() }
            : {}),
        })),
        sections: sections.map((s) => ({
          key: s.key.trim(),
          title: s.title,
          ...(hasI18nText(s.description) ? { description: s.description } : {}),
        })),
      });
      await onSaved();
      setSaveState("saved");
      toast.success(t("questionsSaved"));
    } catch (e) {
      setSaveState("error");
      toast.error(e instanceof ApiError ? e.message : t("couldNotSaveQuestions"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      icon={ListChecksIcon}
      title={t("questions")}
      action={
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPreview(true)}
            disabled={previewFields.length === 0}
          >
            <EyeIcon />
            {t("preview")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={addSection}>
            <PlusIcon />
            {t("addSection")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <PlusIcon />
            {t("addQuestion")}
          </Button>
          <FormPreviewModal
            open={preview}
            onOpenChange={setPreview}
            name={form.name}
            fields={previewFields}
            sections={previewSections}
          />
        </div>
      }
      footer={
        <>
          <SaveStatus state={saving ? "saving" : saveState} className="mr-auto" />
          <SubmitButton type="button" pending={saving} onClick={save}>
            {t("saveQuestions")}
          </SubmitButton>
        </>
      }
    >
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ml-2">
            <ChevronDownIcon className="size-4" />
            {t("reservedKeysToggle")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="text-muted-foreground space-y-2 pt-2 pb-2 text-sm text-pretty">
          <p>{t("reservedKeysDesc")}</p>
          <ul className="list-disc space-y-1 pl-5">
            {RESERVED_FIELD_KEYS.map((r) => (
              <li key={r.key}>
                <code className="bg-muted rounded px-1 py-0.5 text-xs">{r.key}</code>{" "}
                {t(RESERVED_KEY_DESC[r.key])}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
      <AlertModal
        open={missingReservedKeys !== null}
        onOpenChange={(open) => !open && setMissingReservedKeys(null)}
        title={t("missingReservedKeyTitle")}
        description={t("missingReservedKeyDesc", {
          keys: missingReservedKeys?.join(", ") ?? "",
        })}
        cancelLabel={t("back")}
        confirmLabel={t("saveAnyway")}
        onConfirm={() => void doSave()}
      />
      {fields.length === 0 && sections.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title={t("noQuestionsYet")}
          description={t("noQuestionsYetDesc")}
          action={
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <PlusIcon />
              {t("addQuestion")}
            </Button>
          }
        />
      ) : (
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(false)}
        >
          {
            // biome-ignore lint/a11y/noStaticElementInteractions: click-outside-to-collapse convenience only, every field stays reachable via its own controls
            // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
            <div
              className="@container space-y-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) setActiveFieldId(null);
              }}
            >
              <div className="space-y-4">
                {sections.length > 0 && ungroupedBlock.fields.length > 0 && (
                  <p className="text-muted-foreground text-xs font-medium uppercase">
                    {t("noSection")}
                  </p>
                )}
                <SortableContext
                  items={ungroupedBlock.fields.map((f) => f._id)}
                  strategy={verticalListSortingStrategy}
                >
                  {ungroupedBlock.fields.map((field, i) => (
                    <SortableField key={field._id} id={field._id}>
                      {(drag) => (
                        <FieldEditor
                          field={field}
                          index={i}
                          count={ungroupedBlock.fields.length}
                          primaryLocale={language}
                          existingKeys={fields.filter((f) => f._id !== field._id).map((f) => f.key)}
                          dragHandle={<DragHandle {...drag} label={t("dragToReorder")} />}
                          active={activeFieldId === field._id}
                          onActivate={() => setActiveFieldId(field._id)}
                          onChange={(patch) => updateUnsaved(field._id, patch)}
                          onKind={(k) => setKind(field._id, k)}
                          onMove={(dir) => moveWithinBlock(field._id, dir)}
                          onDuplicate={() => duplicateField(field._id)}
                          onRemove={() => remove(field._id)}
                        />
                      )}
                    </SortableField>
                  ))}
                </SortableContext>
                <DroppableBlock
                  id="ungrouped"
                  className={dragging ? "min-h-6 rounded-lg" : undefined}
                >
                  {dragging && ungroupedBlock.fields.length === 0 && <EmptyBlockHint />}
                </DroppableBlock>
              </div>

              <SortableContext
                items={sections.map((s) => s._id)}
                strategy={verticalListSortingStrategy}
              >
                {sections.map((section, sectionIdx) => {
                  const block = blocks.find((b) => b.id === `section:${section.key}`);
                  const blockFields = block?.fields ?? [];
                  return (
                    <SortableSection key={section._id} id={section._id}>
                      {(sectionDrag) => (
                        <div className="border-border bg-muted/20 border-l-primary space-y-4 rounded-lg border border-l-4 p-4">
                          <SectionEditor
                            section={section}
                            index={sectionIdx}
                            count={sections.length}
                            primaryLocale={language}
                            existingKeys={sections
                              .filter((s) => s._id !== section._id)
                              .map((s) => s.key)}
                            dragHandle={
                              <DragHandle {...sectionDrag} label={t("dragSectionToReorder")} />
                            }
                            onChange={(patch) => updateSection(section._id, patch)}
                            onMove={(dir) => moveSection(section._id, dir)}
                            onRemove={() => removeSection(section._id)}
                          />
                          <SortableContext
                            items={blockFields.map((f) => f._id)}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="space-y-4">
                              {blockFields.map((field, i) => (
                                <SortableField key={field._id} id={field._id}>
                                  {(drag) => (
                                    <FieldEditor
                                      field={field}
                                      index={i}
                                      count={blockFields.length}
                                      primaryLocale={language}
                                      existingKeys={fields
                                        .filter((f) => f._id !== field._id)
                                        .map((f) => f.key)}
                                      dragHandle={
                                        <DragHandle {...drag} label={t("dragToReorder")} />
                                      }
                                      active={activeFieldId === field._id}
                                      onActivate={() => setActiveFieldId(field._id)}
                                      onChange={(patch) => updateUnsaved(field._id, patch)}
                                      onKind={(k) => setKind(field._id, k)}
                                      onMove={(dir) => moveWithinBlock(field._id, dir)}
                                      onDuplicate={() => duplicateField(field._id)}
                                      onRemove={() => remove(field._id)}
                                    />
                                  )}
                                </SortableField>
                              ))}
                            </div>
                          </SortableContext>
                          <DroppableBlock
                            id={`section:${section.key}`}
                            className={dragging ? "min-h-6 rounded-lg" : undefined}
                          >
                            {dragging && blockFields.length === 0 && <EmptyBlockHint />}
                          </DroppableBlock>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => addToSection(section.key)}
                            className="text-muted-foreground"
                          >
                            <PlusIcon className="size-3.5" />
                            {t("addQuestion")}
                          </Button>
                        </div>
                      )}
                    </SortableSection>
                  );
                })}
              </SortableContext>
              {sections.length > 0 && (
                <DroppableBlock id="sections-end" className={dragging ? "min-h-6" : undefined} />
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={add} className="flex-1">
                  <PlusIcon />
                  {t("addQuestion")}
                </Button>
                <Button type="button" variant="outline" onClick={addSection} className="flex-1">
                  <PlusIcon />
                  {t("addSection")}
                </Button>
              </div>
            </div>
          }
        </DndContext>
      )}
    </SectionCard>
  );
}

export function fieldKindLabel(kind: FieldKind, t: Translate): string {
  const map: Record<FieldKind, string> = {
    text: t("fieldKindText"),
    textarea: t("fieldKindTextarea"),
    select: t("fieldKindSelect"),
    multiselect: t("fieldKindMultiselect"),
    checkbox: t("fieldKindCheckbox"),
    date: t("fieldKindDate"),
    number: t("fieldKindNumber"),
    file: t("fieldKindFile"),
    university: t("fieldKindUniversity"),
  };
  return map[kind];
}

const FIELD_KIND_ICON: Record<FieldKind, LucideIcon> = {
  text: TypeIcon,
  textarea: AlignLeftIcon,
  select: CircleDotIcon,
  multiselect: ListChecksIcon,
  checkbox: SquareCheckIcon,
  date: CalendarIcon,
  number: HashIcon,
  file: PaperclipIcon,
  university: GraduationCapIcon,
};

/** Kinds where a response-validation rule (length/pattern/range/selection
 *  count) is meaningful — see `checkFieldValidation` in the API's service.ts. */
const VALIDATABLE_KINDS = new Set<FieldKind>(["text", "textarea", "number", "multiselect"]);

/** Kinds where the applicant types free text, so a custom placeholder is
 *  meaningful (choice/date/file/university kinds have their own UI instead). */
const TYPED_KINDS = new Set<FieldKind>(["text", "textarea", "number"]);

function FieldKindIcon({ kind, className }: { kind: FieldKind; className?: string }) {
  const Icon = FIELD_KIND_ICON[kind];
  return <Icon className={className} aria-hidden="true" />;
}

export function FieldEditor({
  field,
  index,
  count,
  primaryLocale,
  existingKeys,
  dragHandle,
  active,
  onActivate,
  onChange,
  onKind,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: TemplateField;
  index: number;
  count: number;
  primaryLocale: Language;
  existingKeys: string[];
  dragHandle?: React.ReactNode;
  active: boolean;
  onActivate: () => void;
  onChange: (patch: Partial<TemplateField>) => void;
  onKind: (kind: FieldKind) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  const uid = useId();

  const topRow = (
    <div className="flex items-center gap-1">
      {dragHandle}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={index === 0}
        onClick={(e) => {
          e.stopPropagation();
          onMove(-1);
        }}
      >
        <ArrowUpIcon className="size-3.5" />
        <span className="sr-only">{t("moveUp")}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={index === count - 1}
        onClick={(e) => {
          e.stopPropagation();
          onMove(1);
        }}
      >
        <ArrowDownIcon className="size-3.5" />
        <span className="sr-only">{t("moveDown")}</span>
      </Button>
    </div>
  );

  if (!active) {
    return (
      <Surface padding="compact" className="hover:border-primary/40 space-y-3 transition-colors">
        {topRow}
        <button type="button" onClick={onActivate} className="w-full text-left">
          <div className="pointer-events-none">
            <FieldPreviewRow field={field} locale={primaryLocale} />
          </div>
        </button>
      </Surface>
    );
  }

  const setLabel = (loc: (typeof LOCALES)[number], val: string) => {
    const followsGeneratedKey =
      /^field_\d+$/.test(field.key) ||
      field.key === generatedFieldKey(field.label[primaryLocale], existingKeys);
    onChange({
      label: { ...field.label, [loc]: val },
      ...(loc === primaryLocale && followsGeneratedKey
        ? { key: generatedFieldKey(val, existingKeys) }
        : {}),
    });
  };
  const setHelpText = (loc: (typeof LOCALES)[number], val: string) =>
    onChange({ help_text: { ...(field.help_text ?? EMPTY_I18N), [loc]: val } });
  const setPlaceholder = (loc: (typeof LOCALES)[number], val: string) =>
    onChange({ placeholder: { ...(field.placeholder ?? EMPTY_I18N), [loc]: val } });

  const setOptions = (options: TemplateField["options"]) => onChange({ options });
  const setValidation = (patch: Partial<FieldValidation>) =>
    onChange({ validation: { ...field.validation, ...patch } });
  const canValidate = VALIDATABLE_KINDS.has(field.kind);

  return (
    <Surface
      padding="compact"
      onClick={(e) => e.stopPropagation()}
      className="border-l-primary space-y-4 border-l-4"
    >
      {topRow}

      <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_12rem]">
        <Input
          aria-label={t("primaryApplicantLabel")}
          placeholder={t("primaryApplicantLabel")}
          value={field.label[primaryLocale]}
          onChange={(e) => setLabel(primaryLocale, e.target.value)}
          className="text-base font-medium"
        />
        <Select value={field.kind} onValueChange={(v) => onKind(v as FieldKind)}>
          <SelectTrigger aria-label={t("kindLabel")} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                <span className="flex items-center gap-2">
                  <FieldKindIcon kind={k} className="text-muted-foreground size-4 shrink-0" />
                  {fieldKindLabel(k, t)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {TYPED_KINDS.has(field.kind) && field.placeholder !== undefined && (
        <Input
          aria-label={t("placeholderTextLabel")}
          value={field.placeholder[primaryLocale] ?? ""}
          onChange={(e) => setPlaceholder(primaryLocale, e.target.value)}
          placeholder={t("placeholderTextLabel")}
          className="text-sm"
        />
      )}

      {field.help_text !== undefined && (
        <Input
          aria-label={t("descriptionLabel")}
          value={field.help_text[primaryLocale] ?? ""}
          onChange={(e) => setHelpText(primaryLocale, e.target.value)}
          placeholder={t("descriptionLabel")}
          className="text-sm"
        />
      )}

      {OPTION_KINDS.includes(field.kind) ? (
        <OptionsEditor
          options={field.options ?? []}
          primaryLocale={primaryLocale}
          onChange={setOptions}
        />
      ) : (
        <AnswerPreviewControl field={field} locale={primaryLocale} />
      )}

      {field.validation && canValidate && (
        <ValidationEditor field={field} primaryLocale={primaryLocale} onChange={setValidation} />
      )}

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t("translationsAndSettings")}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`question-${uid}-${loc}`}>
                  {t("primaryApplicantLabel")} ({loc.toUpperCase()})
                </Label>
                <Input
                  id={`question-${uid}-${loc}`}
                  value={field.label[loc]}
                  onChange={(e) => setLabel(loc, e.target.value)}
                />
              </div>
            ))}
          </div>
          {field.help_text !== undefined && (
            <div className="grid gap-3 sm:grid-cols-2">
              {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
                <div key={loc} className="space-y-1.5">
                  <Label htmlFor={`question-help-${uid}-${loc}`}>
                    {t("descriptionLabel")} ({loc.toUpperCase()})
                  </Label>
                  <Input
                    id={`question-help-${uid}-${loc}`}
                    value={field.help_text?.[loc] ?? ""}
                    onChange={(e) => setHelpText(loc, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
          {TYPED_KINDS.has(field.kind) && field.placeholder !== undefined && (
            <div className="grid gap-3 sm:grid-cols-2">
              {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
                <div key={loc} className="space-y-1.5">
                  <Label htmlFor={`question-placeholder-${uid}-${loc}`}>
                    {t("placeholderTextLabel")} ({loc.toUpperCase()})
                  </Label>
                  <Input
                    id={`question-placeholder-${uid}-${loc}`}
                    value={field.placeholder?.[loc] ?? ""}
                    onChange={(e) => setPlaceholder(loc, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`field-key-${uid}`}>{t("fieldKeyLabel")}</Label>
            <Input
              id={`field-key-${uid}`}
              value={field.key}
              onChange={(e) => onChange({ key: e.target.value })}
              aria-describedby={`field-key-hint-${uid}`}
            />
            <p id={`field-key-hint-${uid}`} className="text-muted-foreground text-xs">
              {t("generatedAutomatically")}
            </p>
          </div>
        </div>
      </details>

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t("advancedFieldSettings")}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`retention-mode-${uid}`}>{t("anonymousAuditRetentionLabel")}</Label>
            <Select
              value={field.retention_mode ?? "none"}
              onValueChange={(value) =>
                onChange({
                  retention_mode: value as "none" | "anonymous_audit",
                  ...(value === "none" ? { anonymous_audit_dimension: undefined } : {}),
                })
              }
            >
              <SelectTrigger id={`retention-mode-${uid}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("anonymousAuditRetentionOff")}</SelectItem>
                <SelectItem value="anonymous_audit">{t("anonymousAuditRetentionOn")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{t("anonymousAuditRetentionHint")}</p>
          </div>
          {field.retention_mode === "anonymous_audit" && (
            <>
              <p role="alert" className="text-destructive text-pretty text-sm">
                {t("anonymousAuditRetentionWarning")}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor={`audit-dimension-${uid}`}>
                  {t("anonymousAuditDimensionLabel")}
                </Label>
                <Input
                  id={`audit-dimension-${uid}`}
                  value={field.anonymous_audit_dimension ?? ""}
                  onChange={(e) => onChange({ anonymous_audit_dimension: e.target.value || null })}
                  placeholder={t("anonymousAuditDimensionPlaceholder")}
                  aria-describedby={`audit-dimension-hint-${uid}`}
                />
                <p id={`audit-dimension-hint-${uid}`} className="text-muted-foreground text-xs">
                  {t("anonymousAuditDimensionHint")}
                </p>
              </div>
            </>
          )}
        </div>
      </details>

      {field.kind === FILE_KIND && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("fileRestrictions")}</summary>
          <div className="mt-3">
            <FileRestrictionsEditor field={field} onChange={onChange} />
          </div>
        </details>
      )}

      <Separator />

      <div className="flex flex-wrap items-center gap-1">
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onDuplicate}>
          <CopyIcon className="size-4" />
          <span className="sr-only">{t("duplicateQuestion")}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-destructive size-8"
          onClick={onRemove}
        >
          <Trash2Icon className="size-4" />
          <span className="sr-only">{t("remove")}</span>
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <Switch
          checked={field.required}
          onCheckedChange={(v) => onChange({ required: v })}
          id={`required-${uid}`}
        />
        <Label htmlFor={`required-${uid}`} className="text-sm">
          {t("required")}
        </Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="ml-auto size-8">
              <MoreVerticalIcon className="size-4" />
              <span className="sr-only">{t("moreOptions")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {TYPED_KINDS.has(field.kind) && (
              <DropdownMenuCheckboxItem
                checked={field.placeholder !== undefined}
                onCheckedChange={(checked) =>
                  onChange({ placeholder: checked ? { ...EMPTY_I18N } : undefined })
                }
              >
                {t("placeholderTextLabel")}
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuCheckboxItem
              checked={field.help_text !== undefined}
              onCheckedChange={(checked) =>
                onChange({ help_text: checked ? { ...EMPTY_I18N } : undefined })
              }
            >
              {t("descriptionLabel")}
            </DropdownMenuCheckboxItem>
            {canValidate && (
              <DropdownMenuCheckboxItem
                checked={!!field.validation}
                onCheckedChange={(checked) => onChange({ validation: checked ? {} : undefined })}
              >
                {t("responseValidation")}
              </DropdownMenuCheckboxItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Surface>
  );
}

/** Response-validation rule editor (H11) — length/pattern for text, min/max
 *  for number, selection count for multiselect, plus a custom error message. */
type TextValidationCategory = "text" | "length" | "regex";
type SelectCountCondition = "at_least" | "at_most" | "exactly";

function ValidationEditor({
  field,
  primaryLocale,
  onChange,
}: {
  field: TemplateField;
  primaryLocale: Language;
  onChange: (patch: Partial<FieldValidation>) => void;
}) {
  const { t } = useLocale();
  const uid = useId();
  const v = field.validation ?? {};

  const numberField = (
    label: string,
    key: "min_length" | "max_length" | "min" | "max",
    extra?: Partial<FieldValidation>,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`validation-${uid}-${key}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`validation-${uid}-${key}`}
        type="number"
        value={v[key] ?? ""}
        onChange={(e) =>
          onChange({ [key]: e.target.value ? Number(e.target.value) : undefined, ...extra })
        }
        className="h-8"
      />
    </div>
  );

  const errorMessageField = (
    <div className="space-y-1.5">
      <Label htmlFor={`validation-${uid}-error`} className="text-xs">
        {t("customErrorMessageLabel")}
      </Label>
      <Input
        id={`validation-${uid}-error`}
        value={v.error_message?.[primaryLocale] ?? ""}
        onChange={(e) =>
          onChange({
            error_message: { ...(v.error_message ?? EMPTY_I18N), [primaryLocale]: e.target.value },
          })
        }
        className="h-8"
      />
    </div>
  );

  if (field.kind === "text" || field.kind === "textarea") {
    const category: TextValidationCategory = v.text_condition
      ? "text"
      : v.pattern !== undefined
        ? "regex"
        : "length";
    const setCategory = (next: TextValidationCategory) => {
      if (next === "text") {
        onChange({
          text_condition: "contains",
          text_value: "",
          pattern: undefined,
          min_length: undefined,
          max_length: undefined,
        });
      } else if (next === "regex") {
        onChange({
          pattern: v.pattern ?? "",
          text_condition: undefined,
          text_value: undefined,
          min_length: undefined,
          max_length: undefined,
        });
      } else {
        onChange({ text_condition: undefined, text_value: undefined, pattern: undefined });
      }
    };
    const needsTextValue = v.text_condition === "contains" || v.text_condition === "not_contains";

    return (
      <div className="space-y-3 border-t pt-4">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("validationCategoryLabel")}</Label>
          <Select
            value={category}
            onValueChange={(val) => setCategory(val as TextValidationCategory)}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">{t("validationCategoryText")}</SelectItem>
              <SelectItem value="length">{t("validationCategoryLength")}</SelectItem>
              <SelectItem value="regex">{t("validationCategoryRegex")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {category === "text" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("conditionLabel")}</Label>
              <Select
                value={v.text_condition ?? "contains"}
                onValueChange={(cond) =>
                  onChange({
                    text_condition: cond as FieldValidation["text_condition"],
                    text_value:
                      cond === "contains" || cond === "not_contains"
                        ? (v.text_value ?? "")
                        : undefined,
                  })
                }
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">{t("conditionContains")}</SelectItem>
                  <SelectItem value="not_contains">{t("conditionNotContains")}</SelectItem>
                  <SelectItem value="email">{t("conditionEmail")}</SelectItem>
                  <SelectItem value="url">{t("conditionUrl")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {needsTextValue && (
              <div className="space-y-1.5">
                <Label htmlFor={`validation-${uid}-text-value`} className="text-xs">
                  {t("valueLabel")}
                </Label>
                <Input
                  id={`validation-${uid}-text-value`}
                  value={v.text_value ?? ""}
                  onChange={(e) => onChange({ text_value: e.target.value })}
                  className="h-8"
                />
              </div>
            )}
          </div>
        )}

        {category === "length" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {numberField(t("minLengthLabel"), "min_length")}
            {numberField(t("maxLengthLabel"), "max_length")}
          </div>
        )}

        {category === "regex" && (
          <div className="space-y-1.5">
            <Label htmlFor={`validation-${uid}-pattern`} className="text-xs">
              {t("patternLabel")}
            </Label>
            <Input
              id={`validation-${uid}-pattern`}
              value={v.pattern ?? ""}
              onChange={(e) => onChange({ pattern: e.target.value })}
              className="h-8"
            />
          </div>
        )}

        {errorMessageField}
      </div>
    );
  }

  if (field.kind === "multiselect") {
    const condition: SelectCountCondition =
      v.min_selected !== undefined && v.min_selected === v.max_selected
        ? "exactly"
        : v.max_selected !== undefined
          ? "at_most"
          : "at_least";
    const count = condition === "at_most" ? v.max_selected : v.min_selected;
    const setCondition = (next: SelectCountCondition, n: number | undefined) => {
      if (next === "at_least") onChange({ min_selected: n, max_selected: undefined });
      else if (next === "at_most") onChange({ min_selected: undefined, max_selected: n });
      else onChange({ min_selected: n, max_selected: n });
    };

    return (
      <div className="space-y-3 border-t pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("selectConditionLabel")}</Label>
            <Select
              value={condition}
              onValueChange={(c) => setCondition(c as SelectCountCondition, count)}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="at_least">{t("selectAtLeast")}</SelectItem>
                <SelectItem value="at_most">{t("selectAtMost")}</SelectItem>
                <SelectItem value="exactly">{t("selectExactly")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`validation-${uid}-count`} className="text-xs">
              {t("countLabel")}
            </Label>
            <Input
              id={`validation-${uid}-count`}
              type="number"
              className="h-8"
              value={count ?? ""}
              onChange={(e) =>
                setCondition(condition, e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
        </div>
        {errorMessageField}
      </div>
    );
  }

  return (
    <div className="border-border bg-muted/20 space-y-3 rounded-md border border-dashed p-3">
      <div className="grid grid-cols-2 gap-3">
        {numberField(t("minValueLabel"), "min")}
        {numberField(t("maxValueLabel"), "max")}
      </div>
      {errorMessageField}
    </div>
  );
}

/** A single section's editor: title/description (i18n), drag handle, delete.
 *  Its member fields render nested below it in `QuestionsCard`. */
export function SectionEditor({
  section,
  index,
  count,
  primaryLocale,
  existingKeys,
  dragHandle,
  onChange,
  onMove,
  onRemove,
}: {
  section: FormSection;
  index: number;
  count: number;
  primaryLocale: Language;
  existingKeys: string[];
  dragHandle?: React.ReactNode;
  onChange: (patch: Partial<FormSection>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  const uid = useId();
  const setTitle = (loc: (typeof LOCALES)[number], val: string) => {
    const followsGeneratedKey =
      /^section_\d+$/.test(section.key) ||
      section.key === generatedFieldKey(section.title[primaryLocale], existingKeys);
    onChange({
      title: { ...section.title, [loc]: val },
      ...(loc === primaryLocale && followsGeneratedKey
        ? { key: generatedFieldKey(val, existingKeys) }
        : {}),
    });
  };
  const setDescription = (loc: (typeof LOCALES)[number], val: string) =>
    onChange({ description: { ...(section.description ?? EMPTY_I18N), [loc]: val } });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {dragHandle}
        <span className="text-muted-foreground text-xs font-medium">#{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon className="size-4" />
            <span className="sr-only">{t("moveUp")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon className="size-4" />
            <span className="sr-only">{t("moveDown")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive size-8"
            onClick={onRemove}
          >
            <Trash2Icon className="size-4" />
            <span className="sr-only">{t("removeSection")}</span>
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Input
          aria-label={t("sectionTitleLabel")}
          placeholder={t("sectionTitleLabel")}
          value={section.title[primaryLocale]}
          onChange={(e) => setTitle(primaryLocale, e.target.value)}
          className="text-lg font-semibold"
        />
        <Input
          aria-label={t("sectionDescriptionLabel")}
          placeholder={`${t("sectionDescriptionLabel")}${t("optionalSuffix")}`}
          value={section.description?.[primaryLocale] ?? ""}
          onChange={(e) => setDescription(primaryLocale, e.target.value)}
          className="text-sm"
        />
      </div>

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t("translationsAndSettings")}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`section-${uid}-${loc}`}>
                  {t("sectionTitleLabel")} ({loc.toUpperCase()})
                </Label>
                <Input
                  id={`section-${uid}-${loc}`}
                  value={section.title[loc]}
                  onChange={(e) => setTitle(loc, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`section-desc-${uid}-${loc}`}>
                  {t("sectionDescriptionLabel")} ({loc.toUpperCase()})
                </Label>
                <Input
                  id={`section-desc-${uid}-${loc}`}
                  value={section.description?.[loc] ?? ""}
                  onChange={(e) => setDescription(loc, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`section-key-${uid}`}>{t("fieldKeyLabel")}</Label>
            <Input
              id={`section-key-${uid}`}
              value={section.key}
              onChange={(e) => onChange({ key: e.target.value })}
            />
          </div>
        </div>
      </details>
    </div>
  );
}

export function OptionsEditor({
  options,
  primaryLocale,
  onChange,
}: {
  options: NonNullable<TemplateField["options"]>;
  primaryLocale: Language;
  onChange: (options: NonNullable<TemplateField["options"]>) => void;
}) {
  const { t } = useLocale();
  const update = (i: number, patch: Partial<{ value: string; label: I18nText }>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const add = () => onChange([...options, { value: "", label: { ...EMPTY_I18N } }]);
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-1">
      {options.length === 0 && (
        <p className="text-muted-foreground text-xs">{t("addAtLeastOneOptionDesc")}</p>
      )}
      {options.map((opt, i) => {
        const updateLabel = (locale: Language, value: string) => {
          const followsGeneratedValue =
            !opt.value || opt.value === generatedFieldKey(opt.label[primaryLocale]);
          update(i, {
            label: { ...opt.label, [locale]: value },
            ...(locale === primaryLocale && followsGeneratedValue
              ? { value: generatedFieldKey(value) }
              : {}),
          });
        };
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
          <div key={i} className="group space-y-2">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="border-muted-foreground/50 size-4 shrink-0 rounded-full border"
              />
              <Input
                aria-label={t("optionApplicantLabel")}
                value={opt.label[primaryLocale]}
                onChange={(e) => updateLabel(primaryLocale, e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                onClick={() => remove(i)}
                aria-label={t("removeOption")}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
            <details className="ml-6">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                {t("translationsAndSettings")}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {LOCALES.filter((locale) => locale !== primaryLocale).map((locale) => (
                  <div key={locale} className="space-y-1.5">
                    <Label htmlFor={`option-${i}-${locale}`}>{locale.toUpperCase()}</Label>
                    <Input
                      id={`option-${i}-${locale}`}
                      value={opt.label[locale]}
                      onChange={(e) => updateLabel(locale, e.target.value)}
                    />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label htmlFor={`option-value-${i}`}>{t("valueLabel")}</Label>
                  <Input
                    id={`option-value-${i}`}
                    value={opt.value}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                </div>
              </div>
            </details>
          </div>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={add}
        className="text-muted-foreground"
      >
        <PlusIcon className="size-3.5" />
        {t("addOption")}
      </Button>
    </div>
  );
}

/** Upload restrictions for a "file" field: allowed extensions + size cap (H12). */
export function FileRestrictionsEditor({
  field,
  onChange,
}: {
  field: TemplateField;
  onChange: (patch: Partial<TemplateField>) => void;
}) {
  const { t } = useLocale();
  const restrictTypes = field.allowed_file_types !== undefined;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Switch
          checked={restrictTypes}
          onCheckedChange={(checked) => onChange({ allowed_file_types: checked ? [] : undefined })}
          id="restrict-file-types"
        />
        <Label htmlFor="restrict-file-types" className="text-sm">
          {t("restrictFileTypesLabel")}
        </Label>
      </div>
      {restrictTypes && (
        <div className="space-y-1.5">
          <Label htmlFor="allowed-file-types" className="text-muted-foreground text-xs uppercase">
            {t("allowedFileTypesLabel")}
          </Label>
          <Input
            id="allowed-file-types"
            value={(field.allowed_file_types ?? []).join(", ")}
            onChange={(e) =>
              onChange({
                allowed_file_types: e.target.value
                  .split(",")
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean),
              })
            }
            placeholder=".pdf, .png, .jpg"
          />
          <p className="text-muted-foreground text-xs">{t("allowedFileTypesDesc")}</p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="max-file-size-mb" className="text-muted-foreground text-xs uppercase">
          {t("maxSizeMbLabel")}
        </Label>
        <Input
          id="max-file-size-mb"
          type="number"
          min={1}
          value={field.max_file_size_mb ?? ""}
          onChange={(e) =>
            onChange({ max_file_size_mb: e.target.value ? Number(e.target.value) : undefined })
          }
          placeholder="10"
        />
        <p className="text-muted-foreground text-xs">{t("blankMax10MbDesc")}</p>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={field.shareable_with_sponsors ?? false}
          onCheckedChange={(v) => onChange({ shareable_with_sponsors: v })}
          id="shareable-with-sponsors"
        />
        <Label htmlFor="shareable-with-sponsors" className="text-sm">
          {t("shareableWithSponsorsLabel")}
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">{t("shareableWithSponsorsDesc")}</p>
    </div>
  );
}
