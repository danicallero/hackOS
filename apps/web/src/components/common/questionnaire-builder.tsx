"use client";

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
import {
  type I18nText,
  type Question,
  type QuestionKind,
  questionnaireSchema,
} from "@hackos/shared/questions";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckSquareIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CopyIcon,
  HashIcon,
  ListChecksIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  ToggleLeftIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { i18nWithEnglishFallback, type Prize } from "@/app/(app)/challenges/shared";
import { DragHandle, SortableItem } from "@/components/common/drag-handle";
import { IconButton } from "@/components/common/icon-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type Translate, useLocale } from "@/lib/i18n";

/** Fixed locale order for translation inputs — English is always the primary
 *  column throughout this builder (see MultilingualInput below). */
const LOCALES = ["es", "en", "gl"] as const;

type BuilderKind = QuestionKind;

function buildQuestionTypes(
  t: Translate,
): { kind: BuilderKind; label: string; description: string }[] {
  return [
    { kind: "scale", label: t("typeNumeric010"), description: t("typeNumeric010Desc") },
    { kind: "integer", label: t("typeInteger"), description: t("typeIntegerDesc") },
    { kind: "float", label: t("typeFloat"), description: t("typeFloatDesc") },
    { kind: "short_text", label: t("fieldKindText"), description: t("typeShortTextDesc") },
    { kind: "long_text", label: t("fieldKindTextarea"), description: t("typeLongTextDesc") },
    { kind: "boolean", label: t("typeBoolean"), description: t("typeBooleanDesc") },
    { kind: "single_choice", label: t("fieldKindSelect"), description: t("typeSingleChoiceDesc") },
    {
      kind: "multi_choice",
      label: t("fieldKindMultiselect"),
      description: t("typeMultiChoiceDesc"),
    },
  ];
}

const EMPTY_I18N: I18nText = { en: "", es: "", gl: "" };

function questionTypeLabel(kind: string, t: Translate): string {
  return buildQuestionTypes(t).find((type) => type.kind === kind)?.label ?? kind;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function defaultQuestion(kind: BuilderKind, index: number, t: Translate): Question {
  const base = {
    key: `${kind}_${index + 1}`,
    label: { ...EMPTY_I18N, en: questionTypeLabel(kind, t) },
    required: false,
  };
  if (kind === "scale") return { ...base, kind, min: 0, max: 10 };
  if (kind === "integer") return { ...base, kind };
  if (kind === "float") return { ...base, kind };
  if (kind === "short_text") return { ...base, kind, maxLength: 280 };
  if (kind === "long_text") return { ...base, kind, maxLength: 5000 };
  if (kind === "single_choice" || kind === "multi_choice") {
    return {
      ...base,
      kind,
      options: [
        { value: "option_1", label: { ...EMPTY_I18N, en: "Option 1" } },
        { value: "option_2", label: { ...EMPTY_I18N, en: "Option 2" } },
      ],
    };
  }
  return { ...base, kind: "boolean" };
}

export function normalizeQuestions(questions: Question[]): Question[] {
  return questionnaireSchema.parse(
    questions.map((question) => {
      if (!question.label.en.trim()) {
        throw new Error(`Question "${question.key || "untitled"}" needs an English label.`);
      }
      const normalized = {
        ...question,
        label: i18nWithEnglishFallback(question.label),
        description: question.description?.en?.trim()
          ? i18nWithEnglishFallback(question.description)
          : undefined,
      };
      if (normalized.kind === "single_choice" || normalized.kind === "multi_choice") {
        return {
          ...normalized,
          options: normalized.options.map((option) => ({
            value: option.value.trim(),
            label: i18nWithEnglishFallback(requireOptionLabel(question.key, option.label)),
          })),
        };
      }
      return normalized;
    }),
  );
}

function requireOptionLabel(questionKey: string, label: I18nText): I18nText {
  if (!label.en.trim()) throw new Error(`An option in "${questionKey}" needs an English label.`);
  return label;
}

export function normalizePrizes(prizes: Prize[]): Prize[] {
  return prizes
    .map((prize) => ({ name: prize.name.trim(), link: prize.link?.trim() || null }))
    .filter((prize) => prize.name.length > 0);
}

export function PrizeBuilder({
  value,
  onChange,
}: {
  value: Prize[];
  onChange: (value: Prize[]) => void;
}) {
  const { t } = useLocale();
  const add = () => onChange([...value, { name: "", link: null }]);
  const update = (index: number, patch: Partial<Prize>) =>
    onChange(value.map((prize, i) => (i === index ? { ...prize, ...patch } : prize)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {value.map((prize, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; a stable id would remount inputs and drop focus.
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <Input
            value={prize.name}
            placeholder={t("prizeNameLabel")}
            aria-label={t("prizeAriaName", { index: index + 1 })}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <Input
            value={prize.link ?? ""}
            type="url"
            placeholder={t("prizeLinkOptionalPlaceholder")}
            aria-label={t("prizeAriaLink", { index: index + 1 })}
            onChange={(event) => update(index, { link: event.target.value })}
          />
          <IconButton
            label={t("removePrizeAria", { index: index + 1 })}
            onClick={() => remove(index)}
          >
            <Trash2Icon className="size-4" />
          </IconButton>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <PlusIcon className="size-4" />
        {value.length === 0 ? t("addPrize") : t("addAnotherPrize")}
      </Button>
    </div>
  );
}

/** Judging panel builder (H30/H44) — mirrors the application form editor's
 *  row pattern (`FieldEditor` in applications/[id]/questions-card.tsx): a
 *  collapsed preview row that expands into the full editor on click, plus
 *  drag-and-drop reordering, minus that editor's sections feature (a
 *  judging panel is always a flat list, issue #423). */
export function JudgingPanelBuilder({
  value,
  onChange,
  disabled = false,
}: {
  value: Question[];
  onChange: (value: Question[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const questionTypes = useMemo(() => buildQuestionTypes(t), [t]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const update = (index: number, question: Question) =>
    onChange(value.map((existing, i) => (i === index ? question : existing)));
  const move = (index: number, dir: -1 | 1) => {
    const next = [...value];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setActiveIndex((prev) => (prev === index ? target : prev === target ? index : prev));
  };
  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setActiveIndex((prev) => (prev === index ? null : prev));
  };
  const duplicate = (index: number) => {
    const source = value[index];
    const existingKeys = new Set(value.map((q) => q.key));
    let key = `${source.key}_copy`;
    while (existingKeys.has(key)) key = `${key}_copy`;
    const copy: Question = { ...source, key };
    const next = [...value];
    next.splice(index + 1, 0, copy);
    onChange(next);
    setActiveIndex(index + 1);
  };

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);
    onChange(arrayMove(value, oldIndex, newIndex));
    setActiveIndex((prev) =>
      prev === null
        ? prev
        : arrayMove(
            value.map((_, i) => i),
            oldIndex,
            newIndex,
          ).indexOf(prev),
    );
  }

  const addField = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <PlusIcon className="size-4" />
          {t("addField")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {questionTypes.map((type) => (
          <DropdownMenuItem
            key={type.kind}
            onSelect={() => {
              onChange([...value, defaultQuestion(type.kind, value.length, t)]);
              setActiveIndex(value.length);
            }}
          >
            <QuestionIcon kind={type.kind} />
            <div>
              <div>{type.label}</div>
              <div className="text-muted-foreground text-xs">{type.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (value.length === 0) return addField;

  return (
    <div className="space-y-4">
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={value.map((_, index) => String(index))}
          strategy={verticalListSortingStrategy}
        >
          {value.map((question, index) => (
            <SortableItem key={String(index)} id={String(index)}>
              {(drag) => (
                <JudgingQuestionRow
                  question={question}
                  index={index}
                  count={value.length}
                  questionTypes={questionTypes}
                  dragHandle={
                    <DragHandle {...drag} label={t("dragToReorder")} disabled={disabled} />
                  }
                  disabled={disabled}
                  active={activeIndex === index}
                  onActivate={() => setActiveIndex(index)}
                  onChange={(next) => update(index, next)}
                  onMove={(dir) => move(index, dir)}
                  onDuplicate={() => duplicate(index)}
                  onRemove={() => remove(index)}
                />
              )}
            </SortableItem>
          ))}
        </SortableContext>
      </DndContext>
      {addField}
    </div>
  );
}

function JudgingQuestionRow({
  question,
  index,
  count,
  questionTypes,
  dragHandle,
  active,
  onActivate,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
  disabled,
}: {
  question: Question;
  index: number;
  count: number;
  questionTypes: { kind: BuilderKind; label: string; description: string }[];
  dragHandle: React.ReactNode;
  active: boolean;
  onActivate: () => void;
  onChange: (question: Question) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useLocale();

  const topRow = (
    <div className="flex items-center gap-1">
      {dragHandle}
      <IconButton
        label={t("moveFieldUp")}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUpIcon className="size-3.5" />
      </IconButton>
      <IconButton
        label={t("moveFieldDown")}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon className="size-3.5" />
      </IconButton>
    </div>
  );

  if (!active) {
    return (
      <Surface padding="compact" className="hover:border-primary/40 space-y-3 transition-colors">
        {topRow}
        <button type="button" onClick={onActivate} disabled={disabled} className="w-full text-left">
          <div className="flex items-center gap-2">
            <QuestionIcon kind={question.kind} />
            <div>
              <div className="font-medium">{question.label.en || `Field ${index + 1}`}</div>
              <div className="text-muted-foreground text-xs">{question.key}</div>
            </div>
          </div>
        </button>
      </Surface>
    );
  }

  const setLabel = (loc: (typeof LOCALES)[number], val: string) =>
    onChange({ ...question, label: { ...question.label, [loc]: val } });
  const setDescription = (loc: (typeof LOCALES)[number], val: string) =>
    onChange({
      ...question,
      description: { ...(question.description ?? EMPTY_I18N), [loc]: val },
    });

  return (
    <Surface
      padding="compact"
      onClick={(e) => e.stopPropagation()}
      className="border-l-primary space-y-4 border-l-4"
    >
      {topRow}

      <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_12rem]">
        <Input
          aria-label={t("labelField")}
          placeholder={t("labelField")}
          value={question.label.en}
          onChange={(e) => setLabel("en", e.target.value)}
          disabled={disabled}
          className="text-base font-medium"
        />
        <Select
          value={question.kind}
          onValueChange={(kind) => onChange(retargetQuestion(question, kind as BuilderKind, t))}
          disabled={disabled}
        >
          <SelectTrigger aria-label={t("colType")} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {questionTypes.map((type) => (
              <SelectItem key={type.kind} value={type.kind}>
                <span className="flex items-center gap-2">
                  <QuestionIcon kind={type.kind} />
                  {type.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Textarea
        aria-label={t("descriptionLabel")}
        placeholder={`${t("descriptionLabel")}${t("optionalSuffix")}`}
        value={question.description?.en ?? ""}
        onChange={(e) => setDescription("en", e.target.value)}
        disabled={disabled}
        className="text-sm"
      />

      <QuestionSettings
        question={question}
        onChange={onChange}
        idPrefix={`question-${index}`}
        disabled={disabled}
      />

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t("translationsAndSettings")}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== "en").map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`question-${index}-label-${loc}`}>
                  {t("labelField")} ({loc.toUpperCase()})
                </Label>
                <Input
                  id={`question-${index}-label-${loc}`}
                  value={question.label[loc]}
                  onChange={(e) => setLabel(loc, e.target.value)}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== "en").map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`question-${index}-description-${loc}`}>
                  {t("descriptionLabel")} ({loc.toUpperCase()})
                </Label>
                <Input
                  id={`question-${index}-description-${loc}`}
                  value={question.description?.[loc] ?? ""}
                  onChange={(e) => setDescription(loc, e.target.value)}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
          <Field id={`question-${index}-key`} label={t("fieldKeyLabel")} hint={t("fieldKeyHint")}>
            <Input
              id={`question-${index}-key`}
              value={question.key}
              placeholder={t("fieldKeyPlaceholder")}
              onChange={(e) => onChange({ ...question, key: slug(e.target.value) })}
              disabled={disabled}
            />
          </Field>
        </div>
      </details>

      <Separator />

      <div className="flex flex-wrap items-center gap-1">
        <IconButton
          type="button"
          label={t("duplicateQuestion")}
          onClick={onDuplicate}
          disabled={disabled}
        >
          <CopyIcon className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          type="button"
          label={t("removeField")}
          className="text-destructive"
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2Icon className="size-4" aria-hidden="true" />
        </IconButton>
        <Separator orientation="vertical" className="mx-1 h-[var(--control-height-tiny)]" />
        <Switch
          checked={question.required}
          onCheckedChange={(required) => onChange({ ...question, required })}
          id={`required-${index}`}
          disabled={disabled}
        />
        <Label htmlFor={`required-${index}`} className="text-sm">
          {t("requiredCheckboxLabel")}
        </Label>
      </div>
    </Surface>
  );
}

function QuestionSettings({
  question,
  onChange,
  idPrefix,
  disabled,
}: {
  question: Question;
  onChange: (question: Question) => void;
  idPrefix: string;
  disabled: boolean;
}) {
  const { t } = useLocale();
  if (question.kind === "scale") {
    return (
      <p className="text-muted-foreground text-sm">
        {t("judgesScoreScale", { min: question.min, max: question.max })}
      </p>
    );
  }
  if (question.kind === "integer" || question.kind === "float") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-minimum`} label={t("minimumLabel")}>
          <Input
            id={`${idPrefix}-minimum`}
            value={question.min ?? ""}
            placeholder={t("noLimitPlaceholder")}
            inputMode={question.kind === "integer" ? "numeric" : "decimal"}
            disabled={disabled}
            onChange={(event) => onChange(numberPatch(question, "min", event.target.value))}
          />
        </Field>
        <Field id={`${idPrefix}-maximum`} label={t("maximumLabel")}>
          <Input
            id={`${idPrefix}-maximum`}
            value={question.max ?? ""}
            placeholder={t("noLimitPlaceholder")}
            inputMode={question.kind === "integer" ? "numeric" : "decimal"}
            disabled={disabled}
            onChange={(event) => onChange(numberPatch(question, "max", event.target.value))}
          />
        </Field>
      </div>
    );
  }
  if (question.kind === "short_text" || question.kind === "long_text") {
    return (
      <Field id={`${idPrefix}-max-length`} label={t("maxLengthLabel")}>
        <Input
          id={`${idPrefix}-max-length`}
          value={question.maxLength}
          inputMode="numeric"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...question, maxLength: Math.max(1, Number(event.target.value) || 1) })
          }
        />
      </Field>
    );
  }
  if (question.kind === "single_choice" || question.kind === "multi_choice") {
    return <OptionsBuilder question={question} onChange={onChange} disabled={disabled} />;
  }
  return null;
}

function OptionsBuilder({
  question,
  onChange,
  disabled,
}: {
  question: Extract<Question, { kind: "single_choice" | "multi_choice" }>;
  onChange: (question: Question) => void;
  disabled: boolean;
}) {
  const { t } = useLocale();
  const [openTranslations, setOpenTranslations] = useState<Record<number, boolean>>({});
  const updateOption = (index: number, patch: Partial<(typeof question.options)[number]>) =>
    onChange({
      ...question,
      options: question.options.map((option, i) =>
        i === index ? { ...option, ...patch } : option,
      ),
    });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("optionsFieldLabel")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...question,
              options: [
                ...question.options,
                {
                  value: `option_${question.options.length + 1}`,
                  label: { ...EMPTY_I18N, en: `Option ${question.options.length + 1}` },
                },
              ],
            })
          }
        >
          <PlusIcon className="size-4" />
          {t("addOption")}
        </Button>
      </div>
      {question.options.map((option, index) => {
        const open = openTranslations[index] ?? false;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: options are positional; a stable id would remount inputs and drop focus.
          <div key={index} className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">
                {t("optionNumberLabel", { index: index + 1 })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setOpenTranslations((state) => ({ ...state, [index]: !open }))}
                >
                  {open ? t("hideTranslations") : t("addTranslations")}
                </Button>
                <IconButton
                  label={t("removeOptionAria", { index: index + 1 })}
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...question,
                      options: question.options.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2Icon className="size-4" />
                </IconButton>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <TaggedControl
                tag={t("valueTag")}
                hint={t("valueHint")}
                value={option.value}
                ariaLabel={t("optionAriaValue", { index: index + 1 })}
                disabled={disabled}
                onChange={(next) => updateOption(index, { value: slug(next) })}
              />
              <TaggedControl
                tag={t("englishTag")}
                value={option.label.en}
                ariaLabel={t("optionAriaLabel", { index: index + 1 })}
                disabled={disabled}
                onChange={(next) => updateOption(index, { label: { ...option.label, en: next } })}
              />
            </div>
            {open && (
              <div className="grid gap-3 sm:grid-cols-2">
                <TaggedControl
                  tag={t("spanishTag")}
                  placeholder={t("defaultsToEnglishPlaceholder")}
                  value={option.label.es}
                  disabled={disabled}
                  onChange={(next) => updateOption(index, { label: { ...option.label, es: next } })}
                />
                <TaggedControl
                  tag={t("galicianTag")}
                  placeholder={t("defaultsToEnglishPlaceholder")}
                  value={option.label.gl}
                  disabled={disabled}
                  onChange={(next) => updateOption(index, { label: { ...option.label, gl: next } })}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MultilingualInput({
  label,
  value,
  onChange,
  open: openProp,
  onOpenChange,
  textarea,
  optional,
}: {
  label: string;
  value: I18nText;
  onChange: (value: I18nText) => void;
  /** Controlled expansion. Omit both to let the control manage its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  textarea?: boolean;
  optional?: boolean;
}) {
  const { t } = useLocale();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  return (
    <div className="space-y-2">
      <div className="flex min-h-[var(--control-height-compact)] items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {label}
          {optional ? t("optionalSuffix") : ""}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(!open)}>
          {open ? t("hideTranslations") : t("addTranslations")}
        </Button>
      </div>
      <TaggedControl
        tag={t("englishTag")}
        textarea={textarea}
        value={value.en}
        onChange={(next) => onChange({ ...value, en: next })}
      />
      {open && (
        <div className="grid gap-2 sm:grid-cols-2">
          <TaggedControl
            tag={t("spanishTag")}
            placeholder={t("defaultsToEnglishPlaceholder")}
            textarea={textarea}
            value={value.es}
            onChange={(next) => onChange({ ...value, es: next })}
          />
          <TaggedControl
            tag={t("galicianTag")}
            placeholder={t("defaultsToEnglishPlaceholder")}
            textarea={textarea}
            value={value.gl}
            onChange={(next) => onChange({ ...value, gl: next })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A single input/textarea with a small caption above it — the language (English,
 * Spanish, Galician) for a translation, or a field name like "Value". The caption
 * stays visible once the input is filled, so you always know which value is which.
 */
function TaggedControl({
  tag,
  hint,
  value,
  placeholder,
  onChange,
  textarea,
  ariaLabel,
  disabled,
}: {
  tag: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const Control = textarea ? Textarea : Input;
  return (
    <div className="space-y-1">
      <div className="flex min-h-5 items-center gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">{tag}</span>
        {hint && <FieldHint text={hint} />}
      </div>
      <Control
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? tag}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex min-h-5 items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && <FieldHint text={hint} />}
      </div>
      {children}
    </div>
  );
}

/** A small "?" affordance that reveals an explanation on hover, focus or tap. */
function FieldHint({ text }: { text: string }) {
  const { t } = useLocale();
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("moreInformationAria")}
            className="text-muted-foreground hover:text-foreground focus-visible:text-foreground inline-flex"
          >
            <CircleHelpIcon className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60 text-pretty">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function QuestionIcon({ kind }: { kind: string }) {
  const className = "text-muted-foreground size-4";
  if (kind === "scale") return <SlidersHorizontalIcon className={className} />;
  if (kind === "integer" || kind === "float") return <HashIcon className={className} />;
  if (kind === "boolean") return <ToggleLeftIcon className={className} />;
  if (kind === "single_choice") return <CircleDotIcon className={className} />;
  if (kind === "multi_choice") return <CheckSquareIcon className={className} />;
  if (kind === "long_text") return <ListChecksIcon className={className} />;
  return <TypeIcon className={className} />;
}

function retargetQuestion(question: Question, kind: BuilderKind, t: Translate): Question {
  const next = defaultQuestion(kind, 0, t);
  return {
    ...next,
    key: question.key,
    label: question.label,
    description: question.description,
    required: question.required,
  };
}

function numberPatch<T extends Extract<Question, { kind: "integer" | "float" }>>(
  question: T,
  field: "min" | "max",
  value: string,
): T {
  const parsed = value === "" ? undefined : Number(value);
  return { ...question, [field]: Number.isFinite(parsed) ? parsed : undefined };
}
