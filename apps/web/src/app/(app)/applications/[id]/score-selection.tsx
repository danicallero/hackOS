"use client";

import { ChecksIcon } from "@phosphor-icons/react/dist/csr/Checks";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ResponseRow } from "@/lib/applications";
import { useLocale } from "@/lib/i18n";
import { matchesScore, type ScoreComparison } from "./response-filters";

export function ScoreSelection({
  rows,
  onSelect,
  disabled,
}: {
  rows: ResponseRow[];
  onSelect: (ids: Set<string>) => void;
  disabled: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [comparison, setComparison] = useState<ScoreComparison>("gt");
  const [threshold, setThreshold] = useState("");
  const valid = threshold.trim() !== "" && Number.isFinite(Number(threshold));
  const matches = valid
    ? rows.filter((row) => matchesScore(row.avg_score, comparison, Number(threshold)))
    : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="max-sm:gap-1 max-sm:px-2 max-sm:text-xs max-sm:has-[>svg:first-child]:pl-2"
          disabled={disabled || rows.length === 0}
        >
          <ChecksIcon aria-hidden="true" />
          {t("selectByScore")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t("selectByScore")}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || disabled) return;
            onSelect(new Set(matches.map((row) => String(row.id))));
            setOpen(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${id}-comparison`}>{t("averageScore")}</Label>
            <Select
              value={comparison}
              onValueChange={(value) => setComparison(value as ScoreComparison)}
            >
              <SelectTrigger id={`${id}-comparison`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="gt">{t("scoreGreaterThan")}</SelectItem>
                <SelectItem value="lt">{t("scoreLessThan")}</SelectItem>
                <SelectItem value="eq">{t("scoreEqualTo")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-threshold`}>{t("scoreColumn")}</Label>
            <Input
              id={`${id}-threshold`}
              type="number"
              step="any"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">{t("scoreSelectionScope")}</p>
          <Button type="submit" className="w-full" disabled={!valid || disabled}>
            {t("selectScoreMatches", { count: matches.length })}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
