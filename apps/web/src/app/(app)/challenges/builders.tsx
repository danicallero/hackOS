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
  HashIcon,
  ListChecksIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  ToggleLeftIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { i18nWithEnglishFallback, type Prize } from "./shared";

type BuilderKind = QuestionKind;

const QUESTION_TYPES: { kind: BuilderKind; label: string; description: string }[] = [
  { kind: "scale", label: "Numeric 0-10", description: "Score slider or number from 0 to 10" },
  { kind: "integer", label: "Integer", description: "Whole number input" },
  { kind: "float", label: "Float", description: "Decimal number input" },
  { kind: "short_text", label: "Short text", description: "One-line text answer" },
  { kind: "long_text", label: "Long text", description: "Long written answer" },
  { kind: "boolean", label: "Boolean", description: "Yes or no answer" },
  { kind: "single_choice", label: "Single choice", description: "One option only" },
  { kind: "multi_choice", label: "Multiple choice", description: "One or more checkbox options" },
];

const EMPTY_I18N: I18nText = { en: "", es: "", gl: "" };
const objectKeys = new WeakMap<object, string>();
let objectKeySeq = 0;

function objectKey(value: object): string {
  const existing = objectKeys.get(value);
  if (existing) return existing;
  objectKeySeq += 1;
  const next = `builder-item-${objectKeySeq}`;
  objectKeys.set(value, next);
  return next;
}

function questionTypeLabel(kind: string): string {
  return QUESTION_TYPES.find((type) => type.kind === kind)?.label ?? kind;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function defaultQuestion(kind: BuilderKind, index: number): Question {
  const base = {
    key: `${kind}_${index + 1}`,
    label: { ...EMPTY_I18N, en: questionTypeLabel(kind) },
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
  const add = () => onChange([...value, { name: "", link: null }]);
  const update = (index: number, patch: Partial<Prize>) =>
    onChange(value.map((prize, i) => (i === index ? { ...prize, ...patch } : prize)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <Card className="border-dashed p-4 shadow-none">
          <div className="space-y-2">
            <p className="text-sm font-medium">No prizes yet</p>
            <p className="text-muted-foreground text-sm text-pretty">
              Add one or more prize labels with an optional public link.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <PlusIcon className="size-4" />
              Add prize
            </Button>
          </div>
        </Card>
      ) : (
        value.map((prize, index) => (
          <Card key={objectKey(prize)} className="gap-4 p-4 shadow-none">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Field label={`Prize ${index + 1} label`}>
                <Input
                  value={prize.name}
                  placeholder="Best overall project"
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </Field>
              <Field label="Optional link">
                <Input
                  value={prize.link ?? ""}
                  placeholder="https://example.com/prize"
                  type="url"
                  onChange={(event) => update(index, { link: event.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="self-end"
                aria-label={`Remove prize ${index + 1}`}
                onClick={() => remove(index)}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          </Card>
        ))
      )}
      {value.length > 0 && (
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <PlusIcon className="size-4" />
          Add another prize
        </Button>
      )}
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
  const [openTranslations, setOpenTranslations] = useState<Record<string, boolean>>({});
  const update = (index: number, question: Question) =>
    onChange(value.map((existing, i) => (i === index ? question : existing)));
  const move = (index: number, dir: -1 | 1) => {
    const next = [...value];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Judging fields</p>
          <p className="text-muted-foreground text-sm text-pretty">
            English is required; Spanish and Galician default to English when left blank.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              <PlusIcon className="size-4" />
              Add field
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {QUESTION_TYPES.map((type) => (
              <DropdownMenuItem
                key={type.kind}
                onSelect={() => onChange([...value, defaultQuestion(type.kind, value.length)])}
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
      </div>

      {value.length === 0 ? (
        <Card className="border-dashed p-4 shadow-none">
          <p className="text-sm font-medium">No judging fields yet</p>
          <p className="text-muted-foreground text-sm text-pretty">
            Add scoring, text, boolean or choice fields to define what judges fill in.
          </p>
        </Card>
      ) : (
        value.map((question, index) => {
          const translationKey = `${question.key}-${index}`;
          const translationsOpen = openTranslations[translationKey] ?? false;
          return (
            <Card key={translationKey} className="gap-4 p-4 shadow-none">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <QuestionIcon kind={question.kind} />
                  <div>
                    <div className="font-medium">{question.label.en || `Field ${index + 1}`}</div>
                    <div className="text-muted-foreground text-xs">{question.key}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="secondary">{questionTypeLabel(question.kind)}</Badge>
                  <IconButton
                    label="Move field up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Move field down"
                    disabled={index === value.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Remove field"
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  >
                    <Trash2Icon className="size-4" />
                  </IconButton>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                <Field label="Question type">
                  <Select
                    value={question.kind}
                    onValueChange={(kind) =>
                      update(index, retargetQuestion(question, kind as BuilderKind))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUESTION_TYPES.map((type) => (
                        <SelectItem key={type.kind} value={type.kind}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Answer required">
                  <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                    <Switch
                      checked={question.required}
                      onCheckedChange={(required) => update(index, { ...question, required })}
                    />
                    <span className="text-sm">Required</span>
                  </div>
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                <Field label="Field key">
                  <Input
                    value={question.key}
                    placeholder="innovation"
                    onChange={(event) =>
                      update(index, { ...question, key: slug(event.target.value) })
                    }
                  />
                </Field>
                <MultilingualInput
                  label="Label"
                  value={question.label}
                  open={translationsOpen}
                  onOpenChange={(open) =>
                    setOpenTranslations((state) => ({ ...state, [translationKey]: open }))
                  }
                  onChange={(label) => update(index, { ...question, label })}
                />
              </div>

              <MultilingualInput
                label="Description"
                value={question.description ?? EMPTY_I18N}
                open={translationsOpen}
                onOpenChange={(open) =>
                  setOpenTranslations((state) => ({ ...state, [translationKey]: open }))
                }
                onChange={(description) => update(index, { ...question, description })}
                textarea
                optional
              />

              <QuestionSettings question={question} onChange={(next) => update(index, next)} />
            </Card>
          );
        })
      )}
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
  if (question.kind === "scale") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Minimum">
          <Input value={question.min} disabled inputMode="numeric" />
        </Field>
        <Field label="Maximum">
          <Input value={question.max} disabled inputMode="numeric" />
        </Field>
      </div>
    );
  }
  if (question.kind === "integer" || question.kind === "float") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Minimum (optional)">
          <Input
            value={question.min ?? ""}
            inputMode={question.kind === "integer" ? "numeric" : "decimal"}
            onChange={(event) => onChange(numberPatch(question, "min", event.target.value))}
          />
        </Field>
        <Field label="Maximum (optional)">
          <Input
            value={question.max ?? ""}
            inputMode={question.kind === "integer" ? "numeric" : "decimal"}
            onChange={(event) => onChange(numberPatch(question, "max", event.target.value))}
          />
        </Field>
      </div>
    );
  }
  if (question.kind === "short_text" || question.kind === "long_text") {
    return (
      <Field label="Max length">
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
        <Label>Options</Label>
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
          Add option
        </Button>
      </div>
      {question.options.map((option, index) => (
        <div
          key={objectKey(option)}
          className="grid gap-3 rounded-md border p-3 md:grid-cols-[180px_1fr_auto]"
        >
          <Field label="Value">
            <Input
              value={option.value}
              onChange={(event) => updateOption(index, { value: slug(event.target.value) })}
            />
          </Field>
          <MultilingualInput
            label="Option label"
            value={option.label}
            open={false}
            onOpenChange={() => undefined}
            onChange={(label) => updateOption(index, { label })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="self-end"
            aria-label={`Remove option ${index + 1}`}
            onClick={() =>
              onChange({ ...question, options: question.options.filter((_, i) => i !== index) })
            }
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function MultilingualInput({
  label,
  value,
  onChange,
  open,
  onOpenChange,
  textarea,
  optional,
}: {
  label: string;
  value: I18nText;
  onChange: (value: I18nText) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  textarea?: boolean;
  optional?: boolean;
}) {
  const Control = textarea ? Textarea : Input;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>
          {label}
          {optional ? " (optional)" : ""}
        </Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(!open)}>
          {open ? "Hide translations" : "Add translations"}
        </Button>
      </div>
      <Control
        value={value.en}
        placeholder="English"
        onChange={(event) => onChange({ ...value, en: event.target.value })}
      />
      {open && (
        <div className="grid gap-2 md:grid-cols-2">
          <Control
            value={value.es}
            placeholder="Spanish, defaults to English"
            onChange={(event) => onChange({ ...value, es: event.target.value })}
          />
          <Control
            value={value.gl}
            placeholder="Galician, defaults to English"
            onChange={(event) => onChange({ ...value, gl: event.target.value })}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
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

function retargetQuestion(question: Question, kind: BuilderKind): Question {
  const next = defaultQuestion(kind, 0);
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
