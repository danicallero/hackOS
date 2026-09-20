"use client";

import { DateTimeInput } from "@/components/common/datetime-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Canonical visibility and delayed-publication controls for records that the
 * API can keep hidden. A published record has no delayed-publication state;
 * a hidden record may optionally be scheduled for publication.
 */
export function PublicationControls<TVisible extends string>({
  id,
  visibility,
  hiddenValue,
  publishedValue,
  hiddenLabel,
  publishedLabel,
  visibilityLabel,
  scheduleLabel,
  publishAtLabel,
  scheduled,
  publishAt,
  disabled = false,
  onVisibilityChange,
  onScheduledChange,
  onPublishAtChange,
}: {
  id: string;
  visibility: TVisible;
  hiddenValue: TVisible;
  publishedValue: TVisible;
  hiddenLabel: string;
  publishedLabel: string;
  visibilityLabel: string;
  scheduleLabel: string;
  publishAtLabel: string;
  scheduled: boolean;
  publishAt: string;
  disabled?: boolean;
  onVisibilityChange: (value: TVisible) => void;
  onScheduledChange: (scheduled: boolean) => void;
  onPublishAtChange: (value: string) => void;
}) {
  const scheduleId = `${id}-schedule`;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-visibility`}>{visibilityLabel}</Label>
        <Select
          value={visibility}
          disabled={disabled}
          onValueChange={(value) => onVisibilityChange(value as TVisible)}
        >
          <SelectTrigger id={`${id}-visibility`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={hiddenValue}>{hiddenLabel}</SelectItem>
            <SelectItem value={publishedValue}>{publishedLabel}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visibility === hiddenValue && (
        <div className="space-y-3">
          <Label htmlFor={scheduleId} className="flex items-center gap-2">
            <Checkbox
              id={scheduleId}
              checked={scheduled}
              disabled={disabled}
              onCheckedChange={(checked) => onScheduledChange(checked === true)}
            />
            {scheduleLabel}
          </Label>
          {scheduled && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-publish-at`}>{publishAtLabel}</Label>
              <DateTimeInput
                id={`${id}-publish-at`}
                value={publishAt}
                disabled={disabled}
                onChange={onPublishAtChange}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
