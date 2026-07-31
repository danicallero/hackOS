"use client";

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
  HashIcon,
  ListChecksIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  ToggleLeftIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type Translate, useLocale } from "@/lib/i18n";
import { i18nWithEnglishFallback, type Prize } from "./shared";

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

export function JudgingPanelBuilder({
  value,
  onChange,
}: {
  value: Question[];
  onChange: (value: Question[]) => void;
}) {
  const { t } = useLocale();
  const questionTypes = useMemo(() => buildQuestionTypes(t), [t]);
  const [openTranslations, setOpenTranslations] = useState<Record<number, boolean>>({});
  const update = (index: number, question: Question) =>
    onChange(value.map((existing, i) => (i === index ? question : existing)));
  const move = (index: number, dir: -1 | 1) => {
    const next = [...value];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addField = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <PlusIcon className="size-4" />
          {t("addField")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {questionTypes.map((type) => (
          <DropdownMenuItem
            key={type.kind}
            onSelect={() => onChange([...value, defaultQuestion(type.kind, value.length, t)])}
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
      {value.map((question, index) => {
        const translationsOpen = openTranslations[index] ?? false;
        const setOpen = (open: boolean) =>
          setOpenTranslations((state) => ({ ...state, [index]: open }));
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: fields are positional; a key tied to question.key would remount inputs and drop focus while typing.
          <Card key={index} className="gap-4 p-4 shadow-none">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <QuestionIcon kind={question.kind} />
                <div>
                  <div className="font-medium">{question.label.en || `Field ${index + 1}`}</div>
                  <div className="text-muted-foreground text-xs">{question.key}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  label={t("moveFieldUp")}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon className="size-4" />
                </IconButton>
                <IconButton
                  label={t("moveFieldDown")}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon className="size-4" />
                </IconButton>
                <IconButton
                  label={t("removeField")}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  <Trash2Icon className="size-4" />
                </IconButton>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("colType")}>
                <Select
                  value={question.kind}
                  onValueChange={(kind) =>
                    update(index, retargetQuestion(question, kind as BuilderKind, t))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {questionTypes.map((type) => (
                      <SelectItem key={type.kind} value={type.kind}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("fieldKeyLabel")} hint={t("fieldKeyHint")}>
                <Input
                  value={question.key}
                  placeholder={t("fieldKeyPlaceholder")}
                  onChange={(event) =>
                    update(index, { ...question, key: slug(event.target.value) })
                  }
                />
              </Field>
            </div>

            <MultilingualInput
              label={t("labelField")}
              value={question.label}
              open={translationsOpen}
              onOpenChange={setOpen}
              onChange={(label) => update(index, { ...question, label })}
            />
            <MultilingualInput
              label={t("descriptionLabel")}
              value={question.description ?? EMPTY_I18N}
              open={translationsOpen}
              onOpenChange={setOpen}
              onChange={(description) => update(index, { ...question, description })}
              textarea
              optional
            />

            <QuestionSettings question={question} onChange={(next) => update(index, next)} />

            <div className="flex items-center gap-2">
              <Switch
                id={`required-${index}`}
                checked={question.required}
                onCheckedChange={(required) => update(index, { ...question, required })}
              />
              <Label htmlFor={`required-${index}`}>{t("requiredCheckboxLabel")}</Label>
            </div>
          </Card>
        );
      })}
      {addField}
    </div>
  );
}

function QuestionSettings({
  question,
  onChange,
}: {
  question: Question;
  onChange: (question: Question) => void;
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
        <Field label={t("minimumLabel")}>
          <Input
            value={question.min ?? ""}
            placeholder={t("noLimitPlaceholder")}
            inputMode={question.kind === "integer" ? "numeric" : "decimal"}
            onChange={(event) => onChange(numberPatch(question, "min", event.target.value))}
          />
        </Field>
        <Field label={t("maximumLabel")}>
          <Input
            value={question.max ?? ""}
            placeholder={t("noLimitPlaceholder")}
            inputMode={question.kind === "integer" ? "numeric" : "decimal"}
            onChange={(event) => onChange(numberPatch(question, "max", event.target.value))}
          />
        </Field>
      </div>
    );
  }
  if (question.kind === "short_text" || question.kind === "long_text") {
    return (
      <Field label={t("maxLengthLabel")}>
        <Input
          value={question.maxLength}
          inputMode="numeric"
          onChange={(event) =>
            onChange({ ...question, maxLength: Math.max(1, Number(event.target.value) || 1) })
          }
        />
      </Field>
    );
  }
  if (question.kind === "single_choice" || question.kind === "multi_choice") {
    return <OptionsBuilder question={question} onChange={onChange} />;
  }
  return null;
}

function OptionsBuilder({
  question,
  onChange,
}: {
  question: Extract<Question, { kind: "single_choice" | "multi_choice" }>;
  onChange: (question: Question) => void;
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
        <Label>{t("optionsFieldLabel")}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
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
          {t("addOptionButton")}
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
                  onClick={() => setOpenTranslations((state) => ({ ...state, [index]: !open }))}
                >
                  {open ? t("hideTranslations") : t("addTranslations")}
                </Button>
                <IconButton
                  label={t("removeOptionAria", { index: index + 1 })}
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
                onChange={(next) => updateOption(index, { value: slug(next) })}
              />
              <TaggedControl
                tag={t("englishTag")}
                value={option.label.en}
                ariaLabel={t("optionAriaLabel", { index: index + 1 })}
                onChange={(next) => updateOption(index, { label: { ...option.label, en: next } })}
              />
            </div>
            {open && (
              <div className="grid gap-3 sm:grid-cols-2">
                <TaggedControl
                  tag={t("spanishTag")}
                  placeholder={t("defaultsToEnglishPlaceholder")}
                  value={option.label.es}
                  onChange={(next) => updateOption(index, { label: { ...option.label, es: next } })}
                />
                <TaggedControl
                  tag={t("galicianTag")}
                  placeholder={t("defaultsToEnglishPlaceholder")}
                  value={option.label.gl}
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
      <div className="flex min-h-8 items-center justify-between gap-2">
        <Label>
          {label}
          {optional ? t("optionalSuffix") : ""}
        </Label>
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
}: {
  tag: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  ariaLabel?: string;
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
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
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
            <CircleHelpIcon className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60 text-pretty">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
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
