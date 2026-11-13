"use client";

// Question builder (H11): sections and the fields nested inside them, with
// drag-and-drop reordering (dnd-kit) mirroring the up/down buttons — drag is
// the fast path, the buttons are the keyboard-reliable fallback.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { RESERVED_FIELD_KEYS } from "@hackos/shared/applications";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AlertModal } from "@/components/common/alert-modal";
import { dragOverlayDropAnimation, useReducedDragMotion } from "@/components/common/drag-handle";
import { EmptyState } from "@/components/common/empty-state";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { useSortableSensors } from "@/components/common/use-sortable-sensors";
import { FieldEditor } from "@/components/forms/field-editor/field-editor";
import { AddFieldMenu } from "@/components/forms/field-editor/field-kinds";
import { SectionEditor } from "@/components/forms/field-editor/section-editor";
import { FieldPreviewRow, FormPreviewModal } from "@/components/forms/form-preview";
import {
  DragHandle,
  DroppableBlock,
  EmptyBlockHint,
  SortableField,
  SortableSection,
} from "@/components/forms/questions-dnd";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Surface } from "@/components/ui/surface";
import { useFoodIntolerances } from "@/hooks/use-food-intolerances";
import { useShirtSizes } from "@/hooks/use-shirt-sizes";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { hasI18nText, serializeApplicationField } from "@/lib/application-field-serialize";
import { logisticsPreviewFields, withLogisticsSection } from "@/lib/application-form";
import { generatedFieldKey } from "@/lib/application-workflow";
import {
  type ApplicationForm,
  type FieldKind,
  type FormSection,
  OPTION_KINDS,
  type TemplateField,
} from "@/lib/applications";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { EMPTY_I18N } from "@/lib/i18n-text";
import type { SaveState } from "@/lib/save-state";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

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

export function newField(index: number, kind: FieldKind = "text"): EditableField {
  return {
    _id: mkId(),
    key: `field_${index + 1}`,
    label: { ...EMPTY_I18N },
    kind,
    required: false,
    retention_mode: "none",
    ...(OPTION_KINDS.includes(kind) ? { options: [{ value: "", label: { ...EMPTY_I18N } }] } : {}),
  };
}

function newSection(index: number): EditableSection {
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
  const ungrouped = fields.filter(
    (f) =>
      (!f.section_key || !knownKeys.has(f.section_key)) &&
      (!f.after_section_key || !knownKeys.has(f.after_section_key)),
  );
  const blocks: Block[] = [{ id: "ungrouped", section: null, fields: ungrouped }];
  for (const s of sections) {
    blocks.push({
      id: `section:${s.key}`,
      section: s,
      fields: fields.filter((f) => f.section_key === s.key),
    });
    blocks.push({
      id: `after-section:${s.key}`,
      section: null,
      fields: fields.filter((f) => !f.section_key && f.after_section_key === s.key),
    });
  }
  return blocks;
}

function isContainerId(id: string): boolean {
  return id === "ungrouped" || id.startsWith("section:") || id.startsWith("after-section:");
}

function blockIdForField(field: EditableField, sections: EditableSection[]): string {
  return field.section_key && sections.some((s) => s.key === field.section_key)
    ? `section:${field.section_key}`
    : field.after_section_key && sections.some((s) => s.key === field.after_section_key)
      ? `after-section:${field.after_section_key}`
      : "ungrouped";
}

export function QuestionsCard({
  form,
  onSaved,
  onDirtyChange,
  saveDefinition,
}: {
  form: Pick<ApplicationForm, "id" | "name" | "template" | "sections"> &
    Partial<Pick<ApplicationForm, "ask_shirt_size" | "ask_food_intolerances">>;
  /** H16: projects persist the same form schema through their own endpoint. */
  saveDefinition?: (definition: {
    template: TemplateField[];
    sections: FormSection[];
    field_renames: { from: string; to: string }[];
    library_deletions: string[];
  }) => Promise<unknown>;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const reducedDragMotion = useReducedDragMotion();
  const { t, language } = useLocale();
  const [fields, setFields] = useState<EditableField[]>(() => withIds(form.template));
  const originalFieldsRef = useRef(new Map<string, { key: string; kind: string }>());
  const [sections, setSections] = useState<EditableSection[]>(() => withIds(form.sections));
  // Only the question you're editing expands into the full editor; every
  // other question just shows its live preview.
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  // Set only while a question/section is being dragged, so the "drop here"
  // empty placeholder only shows up during a drag instead of sitting there
  // always, and the DragOverlay clone knows which item to render.
  const [dragActive, setDragActive] = useState<{ id: string; type: "field" | "section" } | null>(
    null,
  );
  const dragging = dragActive !== null;
  const [saving, setSaving] = useState(false);
  const [libraryDirty, setLibraryDirty] = useState(false);
  const [discardLibraryEdits, setDiscardLibraryEdits] = useState<(() => void) | null>(null);
  const requestLibraryAction = (action: () => void) => {
    if (libraryDirty) setDiscardLibraryEdits(() => action);
    else action();
  };
  const requestFieldChange = (next: string | null) =>
    requestLibraryAction(() => setActiveFieldId(next));
  const [libraryDeletions, setLibraryDeletions] = useState<string[]>([]);
  const [libraryRemoval, setLibraryRemoval] = useState<{ id: string; kind?: FieldKind } | null>(
    null,
  );
  const [preview, setPreview] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [missingReservedKeys, setMissingReservedKeys] = useState<string[] | null>(null);
  const { intolerances } = useFoodIntolerances();
  const { sizes: shirtSizes } = useShirtSizes();
  const dndSensors = useSortableSensors();

  // Re-seed if the form reloads (e.g. after a metadata save).
  useEffect(() => {
    if (saveState !== "saved") return;
    const seededFields = withIds(form.template);
    originalFieldsRef.current = new Map(
      seededFields.map((field) => [field._id, { key: field.key, kind: field.kind }]),
    );
    setFields(seededFields);
    setSections(withIds(form.sections));
  }, [form.template, form.sections, saveState]);

  useEffect(() => {
    onDirtyChange?.(saveState !== "saved" || libraryDirty);
  }, [saveState, onDirtyChange, libraryDirty]);

  // What the applicant actually sees: custom questions plus whatever
  // shirt-size/dietary fields Form settings' logistics toggles add at submit
  // (mirrors the server's enrichTemplate — H12). Previewing only `fields`
  // would silently hide the very fields those toggles turn on. Those synthetic
  // fields are tagged with the reserved Logistics section, so they group under
  // their own header instead of dangling as ungrouped fields.
  const hasLogisticsFields = Boolean(form.ask_shirt_size || form.ask_food_intolerances);
  const previewFields = [
    ...fields,
    ...logisticsPreviewFields(
      form.ask_shirt_size ?? false,
      form.ask_food_intolerances ?? false,
      intolerances,
      shirtSizes,
    ),
  ];
  const previewSections = withLogisticsSection(sections, hasLogisticsFields);

  const blocks = buildBlocks(fields, sections);
  const ungroupedBlock = blocks[0];

  // #935/H16: a form has at most one profile CV field and one project
  // description field, so choosing one clears the rest.
  const update = (id: string, patch: Partial<TemplateField>) =>
    setFields((prev) =>
      prev.map((f) =>
        f._id === id
          ? { ...f, ...patch }
          : {
              ...f,
              ...(patch.profile_cv && f.profile_cv ? { profile_cv: false } : {}),
              ...(patch.project_description && f.project_description
                ? { project_description: false }
                : {}),
            },
      ),
    );

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

  const applyRemove = (id: string) => {
    setSaveState("unsaved");
    setFields((prev) => prev.filter((f) => f._id !== id));
    setActiveFieldId((prev) => (prev === id ? null : prev));
  };

  const remove = (id: string) => {
    const field = fields.find((item) => item._id === id);
    if (field?.library_id) {
      setLibraryRemoval({ id });
      return;
    }
    applyRemove(id);
  };
  const add = (kind: FieldKind = "text") => {
    setSaveState("unsaved");
    const field = newField(fields.length, kind);
    setFields((prev) => [...prev, field]);
    setActiveFieldId(field._id);
  };

  const addToSection = (sectionKey: string, kind: FieldKind = "text") => {
    setSaveState("unsaved");
    const field = { ...newField(fields.length, kind), section_key: sectionKey };
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
        library_id: undefined,
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
      prev.map((f) => ({
        ...f,
        ...(f.section_key === removedKey ? { section_key: undefined } : {}),
        ...(f.after_section_key === removedKey ? { after_section_key: undefined } : {}),
      })),
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

      // Match the sortable destination when moving within a block (issue #849).
      if (overFieldId && blockIdForField(activeField, sections) === destBlockId) {
        return arrayMove(
          prev,
          prev.findIndex((field) => field._id === activeId),
          prev.findIndex((field) => field._id === overFieldId),
        );
      }

      const destSectionKey = destBlockId.startsWith("section:")
        ? destBlockId.slice("section:".length)
        : undefined;
      const afterSectionKey = destBlockId.startsWith("after-section:")
        ? destBlockId.slice("after-section:".length)
        : undefined;
      const movedField: EditableField = {
        ...activeField,
        section_key: destSectionKey,
        after_section_key: afterSectionKey,
      };

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

  function handleDragStart(event: DragStartEvent) {
    const type = event.active.data.current?.type;
    if (type === "section" || type === "field") {
      setDragActive({ id: String(event.active.id), type });
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragActive(null);
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
      if (
        (f.section_key && !sectionSeen.has(f.section_key)) ||
        (f.after_section_key && !sectionSeen.has(f.after_section_key))
      ) {
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

  function save() {
    const err = validate();
    if (err) {
      toast.error(err, t("saveQuestions"));
      return;
    }
    // Nudge (not block) toward wiring up the reserved profile-autofill keys
    // (H11/H12) — a form missing them still works, it just won't sync DNI etc.
    // with the applicant's profile, so this is skippable.
    const presentKeys = new Set(fields.map((f) => f.key.trim().toLowerCase()));
    const missing = RESERVED_FIELD_KEYS.map((r) => r.key).filter((k) => !presentKeys.has(k));
    if (!saveDefinition && missing.length > 0) {
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
      const definition = {
        template: fields.map(serializeApplicationField),
        library_deletions: libraryDeletions,
        field_renames: fields.flatMap((field) => {
          const previous = originalFieldsRef.current.get(field._id);
          return previous && previous.key !== field.key && previous.kind === field.kind
            ? [{ from: previous.key, to: field.key }]
            : [];
        }),
        sections: sections.map((s) => ({
          key: s.key.trim(),
          title: s.title,
          ...(hasI18nText(s.description) ? { description: s.description } : {}),
        })),
      };
      if (saveDefinition) await saveDefinition(definition);
      else await api.patch<ApplicationForm>(`/api/applications/${form.id}`, definition);
      await onSaved();
      setSaveState("saved");
      setLibraryDeletions([]);
      toast.success(t("questionsSaved"), { compactTitle: t("saveQuestions") });
    } catch (e) {
      setSaveState("error");
      toast.error(apiErrorText(e, t, t("couldNotSaveQuestions")), t("saveQuestions"));
    } finally {
      setSaving(false);
    }
  }

  function renderFields(block: Block) {
    return (
      <SortableContext
        items={block.fields.map((f) => f._id)}
        strategy={verticalListSortingStrategy}
      >
        {block.fields.map((field, i) => (
          <SortableField key={field._id} id={field._id}>
            {(drag) => (
              <FieldEditor
                fieldId={field._id}
                field={field}
                availableSections={sections}
                index={i}
                count={block.fields.length}
                primaryLocale={language}
                existingKeys={fields.filter((f) => f._id !== field._id).map((f) => f.key)}
                dragHandle={<DragHandle {...drag} label={t("dragToReorder")} />}
                projectMode={Boolean(saveDefinition)}
                formId={form.id}
                onLibraryDirtyChange={setLibraryDirty}
                active={activeFieldId === field._id}
                onActivate={() => requestFieldChange(field._id)}
                onDeactivate={() => requestFieldChange(null)}
                onChange={(patch) => updateUnsaved(field._id, patch)}
                onKind={(k) => {
                  if (field.library_id && k !== "library") {
                    setLibraryRemoval({ id: field._id, kind: k });
                    return;
                  }
                  setKind(field._id, k);
                }}
                onMove={(dir) => moveWithinBlock(field._id, dir)}
                onDuplicate={() => requestLibraryAction(() => duplicateField(field._id))}
                onRemove={() => remove(field._id)}
              />
            )}
          </SortableField>
        ))}
      </SortableContext>
    );
  }

  return (
    <SectionCard
      variant="plain"
      stickyFooter
      title={t("formFields")}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPreview(true)}
            disabled={previewFields.length === 0}
          >
            <EyeIcon aria-hidden="true" />
            {t("preview")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => requestLibraryAction(addSection)}
          >
            <PlusIcon aria-hidden="true" />
            {t("addSection")}
          </Button>
          <AddFieldMenu
            projectMode={Boolean(saveDefinition)}
            onSelect={(kind) => requestLibraryAction(() => add(kind))}
            size="sm"
          />
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
          <SaveStatus
            state={saving ? "saving" : saveState}
            showIcon={!saving}
            className="mr-auto"
          />
          {libraryDirty && (
            <span className="text-sm text-muted-foreground">{t("saveLibraryBeforeForm")}</span>
          )}
          <SubmitButton type="button" pending={saving} disabled={libraryDirty} onClick={save}>
            {t("saveQuestions")}
          </SubmitButton>
        </>
      }
    >
      <AlertModal
        open={discardLibraryEdits !== null}
        onOpenChange={(open) => !open && setDiscardLibraryEdits(null)}
        title={t("unsavedChanges")}
        description={t("unsavedChangesConfirm")}
        cancelLabel={t("cancel")}
        confirmLabel={t("discardLibraryChanges")}
        destructive
        onConfirm={() => {
          const element = document.querySelector(`[data-field-id="${activeFieldId}"]`);
          const top = element?.getBoundingClientRect().top;
          flushSync(() => discardLibraryEdits?.());
          if (top !== undefined && element?.isConnected)
            window.scrollBy({ top: element.getBoundingClientRect().top - top });
          setDiscardLibraryEdits(null);
        }}
      />
      <AlertModal
        open={libraryRemoval !== null}
        onOpenChange={(open) => !open && setLibraryRemoval(null)}
        title={t("deleteFieldLibraryTitle")}
        description={t("deleteFieldLibraryDescription")}
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => {
          if (!libraryRemoval) return;
          const field = fields.find((item) => item._id === libraryRemoval.id);
          if (field?.library_id)
            setLibraryDeletions((ids) => [...new Set([...ids, field.library_id!])]);
          if (libraryRemoval.kind) setKind(libraryRemoval.id, libraryRemoval.kind);
          else applyRemove(libraryRemoval.id);
          setLibraryRemoval(null);
        }}
      />
      {!saveDefinition && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ml-2">
              <CaretDownIcon aria-hidden="true" className="size-4" />
              {t("reservedKeysToggle")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="text-muted-foreground space-y-2 pt-2 pb-2 text-sm text-pretty">
            <p>{t("reservedKeysDesc")}</p>
            <ul className="list-disc space-y-1 pl-5">
              {RESERVED_FIELD_KEYS.map((r) => (
                <li key={r.key}>
                  <code className="bg-muted rounded px-1 py-0.5 text-xs">{r.key}</code>:{" "}
                  {t(RESERVED_KEY_DESC[r.key])}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
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
          title={t("noQuestionsYet")}
          description={t("noQuestionsYetDesc")}
          action={
            <AddFieldMenu
              projectMode={Boolean(saveDefinition)}
              onSelect={(kind) => requestLibraryAction(() => add(kind))}
              size="sm"
            />
          }
        />
      ) : (
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragActive(null)}
        >
          {
            // biome-ignore lint/a11y/noStaticElementInteractions: click-outside-to-collapse convenience only, every field stays reachable via its own controls
            // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
            <div
              className="@container space-y-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) requestFieldChange(null);
              }}
            >
              {(ungroupedBlock.fields.length > 0 || dragging) && (
                <div className="space-y-4">
                  {sections.length > 0 && ungroupedBlock.fields.length > 0 && (
                    <p className="text-muted-foreground text-xs font-medium">{t("noSection")}</p>
                  )}
                  {renderFields(ungroupedBlock)}
                  <DroppableBlock
                    id="ungrouped"
                    className={dragging ? "min-h-6 rounded-lg" : undefined}
                  >
                    {dragging && <EmptyBlockHint />}
                  </DroppableBlock>
                </div>
              )}

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
                        <div className="space-y-4">
                          <section
                            aria-label={section.title[language] || section.key}
                            className={cn(
                              "space-y-4",
                              sectionIdx > 0 && "border-t border-border/60 pt-6",
                            )}
                          >
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
                            {block && renderFields(block)}
                            <DroppableBlock
                              id={`section:${section.key}`}
                              className={dragging ? "min-h-6 rounded-lg" : undefined}
                            >
                              {(blockFields.length === 0 || dragging) && <EmptyBlockHint />}
                            </DroppableBlock>
                            <AddFieldMenu
                              projectMode={Boolean(saveDefinition)}
                              onSelect={(kind) =>
                                requestLibraryAction(() => addToSection(section.key, kind))
                              }
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground"
                            />
                          </section>
                          {renderFields(
                            blocks.find((b) => b.id === `after-section:${section.key}`)!,
                          )}
                          <DroppableBlock
                            id={`after-section:${section.key}`}
                            className={dragging ? "min-h-12 rounded-lg" : undefined}
                          >
                            {dragging && (
                              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                                {t("applicationDropAfterSection", {
                                  name: section.title[language] || section.key,
                                })}
                              </p>
                            )}
                          </DroppableBlock>
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
                <AddFieldMenu
                  projectMode={Boolean(saveDefinition)}
                  onSelect={(kind) => requestLibraryAction(() => add(kind))}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => requestLibraryAction(addSection)}
                  className="flex-1"
                >
                  <PlusIcon aria-hidden="true" />
                  {t("addSection")}
                </Button>
              </div>
            </div>
          }
          <DragOverlay dropAnimation={reducedDragMotion ? null : dragOverlayDropAnimation}>
            {dragActive?.type === "field" &&
              (() => {
                const field = fields.find((f) => f._id === dragActive.id);
                return (
                  field && (
                    <Surface padding="compact" className="shadow-floating">
                      <FieldPreviewRow field={field} locale={language} />
                    </Surface>
                  )
                );
              })()}
            {dragActive?.type === "section" &&
              (() => {
                const section = sections.find((s) => s._id === dragActive.id);
                return (
                  section && (
                    <Surface padding="compact" className="border-primary/60 shadow-floating">
                      <div className="font-medium">{section.title[language] || section.key}</div>
                    </Surface>
                  )
                );
              })()}
          </DragOverlay>
        </DndContext>
      )}
    </SectionCard>
  );
}
