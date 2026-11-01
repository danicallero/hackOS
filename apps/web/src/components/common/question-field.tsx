"use client";

// Renderer for one typed question of a JSONB question set (H44): the judging
// panel uses it inside a room, the reviews overview reuses it to show and
// correct the same answers after the fact. Kept here (not in the judging page)
// so both surfaces render an evaluation identically.

import type { AnswerValue, Question } from "@hackos/shared/questions";
import { useId } from "react";
import { ScaleButtons } from "@/components/common/scale-buttons";
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
// Label picker lives with the challenge types that define TranslatedText.
import { textForDisplay } from "@/lib/challenges";
import { useLocale } from "@/lib/i18n";

/** Renders the input control matching `question.kind` (scale, integer/float,
 *  boolean, single/multi choice, long text, or plain text). */
export function QuestionField({
  question,
  value,
  disabled,
  readOnly = false,
  onFocus,
  onBlur,
  lockedMessage,
  onChange,
}: {
  question: Question;
  /** Current answer; use `normalizeAnswers`/`defaultValue` to seed this from storage. */
  value: AnswerValue | undefined;
  disabled: boolean;
  /** Used by collaborative text fields while another editor owns the lease. */
  readOnly?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  lockedMessage?: string | null;
  onChange: (value: AnswerValue) => void;
}) {
  const { t } = useLocale();
  const label = textForDisplay(question.label);
  const description = textForDisplay(question.description);
  const uniqueId = useId();
  const id = `question-${question.key}-${uniqueId}`;
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const lockId = `${id}-lock`;
  const describedBy =
    [description && descriptionId, lockedMessage && lockId].filter(Boolean).join(" ") || undefined;
  const controlAria = {
    "aria-labelledby": labelId,
    "aria-describedby": describedBy,
    "aria-required": question.required || undefined,
  };

  return (
    <fieldset aria-labelledby={labelId} className="space-y-2 rounded-md border p-4">
      <Label
        id={labelId}
        htmlFor={
          question.kind === "multi_choice" ||
          (question.kind === "scale" && question.max - question.min <= 10)
            ? undefined
            : id
        }
        className="text-sm font-medium"
      >
        {label}
        {question.required ? (
          <>
            <span aria-hidden="true" className="text-destructive">
              {" "}
              *
            </span>
            {(question.kind === "multi_choice" ||
              (question.kind === "scale" && question.max - question.min <= 10)) && (
              <span className="sr-only"> ({t("required")})</span>
            )}
          </>
        ) : null}
      </Label>
      {description && (
        <p id={descriptionId} className="text-muted-foreground text-sm text-pretty">
          {description}
        </p>
      )}
      {lockedMessage && (
        <p id={lockId} role="status" className="text-muted-foreground text-sm">
          {lockedMessage}
        </p>
      )}
      {question.kind === "scale" && question.max - question.min <= 10 ? (
        <ScaleButtons
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          min={question.min}
          max={question.max}
          value={typeof value === "number" ? value : null}
          onChange={(v) => onChange(v ?? "")}
          disabled={disabled}
        />
      ) : question.kind === "scale" || question.kind === "integer" || question.kind === "float" ? (
        <Input
          id={id}
          {...controlAria}
          type="number"
          min={question.min}
          max={question.max}
          step={question.kind === "float" ? "0.1" : "1"}
          value={typeof value === "number" ? value : ""}
          disabled={disabled}
          readOnly={readOnly}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : question.kind === "boolean" ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            {...controlAria}
            checked={Boolean(value)}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Label htmlFor={id} className="font-normal">
            {t("yesLabel")}
          </Label>
        </div>
      ) : question.kind === "single_choice" ? (
        <Select
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onValueChange={onChange}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={t("selectOptionPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {question.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {textForDisplay(option.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : question.kind === "multi_choice" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {question.options.map((option) => {
            const selected = Array.isArray(value) && value.includes(option.value);
            return (
              <div key={option.value} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-${option.value}`}
                  aria-describedby={describedBy}
                  checked={selected}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    const current = Array.isArray(value) ? value : [];
                    onChange(
                      checked
                        ? [...current, option.value]
                        : current.filter((item) => item !== option.value),
                    );
                  }}
                />
                <Label htmlFor={`${id}-${option.value}`} className="font-normal">
                  {textForDisplay(option.label)}
                </Label>
              </div>
            );
          })}
        </div>
      ) : question.kind === "long_text" ? (
        <Textarea
          id={id}
          {...controlAria}
          value={typeof value === "string" ? value : ""}
          maxLength={question.maxLength}
          disabled={disabled}
          readOnly={readOnly}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          {...controlAria}
          value={typeof value === "string" ? value : ""}
          maxLength={question.maxLength}
          disabled={disabled}
          readOnly={readOnly}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </fieldset>
  );
}
