"use client";

import { Cell, Label, Pie, PieChart } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { TONE_FG, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

export interface DonutSegment {
  key: string;
  label?: string;
  value: number;
  tone?: Tone;
}

const FALLBACK: Tone[] = ["brand", "info", "success", "warning", "danger", "neutral"];

/**
 * Donut/ring chart with an optional centered label+value, as in the Docker
 * disk-usage card. Segments carry their own tone; one component for every
 * distribution (shirt sizes, dietary restrictions, funnel breakdowns…).
 */
export function DonutChart({
  data,
  centerLabel,
  centerValue,
  height = 220,
  showLegend = true,
  className,
}: {
  data: DonutSegment[];
  centerLabel?: string;
  centerValue?: React.ReactNode;
  height?: number;
  showLegend?: boolean;
  className?: string;
}) {
  const segments = data.map((s, i) => ({
    ...s,
    tone: s.tone ?? FALLBACK[i % FALLBACK.length],
  }));
  const config: ChartConfig = Object.fromEntries(
    segments.map((s) => [s.key, { label: s.label ?? s.key, color: TONE_FG[s.tone as Tone] }]),
  );

  return (
    <ChartContainer config={config} className={cn("mx-auto w-full", className)} style={{ height }}>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="key" />} />
        <Pie
          data={segments}
          dataKey="value"
          nameKey="key"
          innerRadius="62%"
          outerRadius="90%"
          paddingAngle={2}
          strokeWidth={0}
        >
          {segments.map((s) => (
            <Cell key={s.key} fill={TONE_FG[s.tone as Tone]} />
          ))}
          {(centerLabel || centerValue !== undefined) && (
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox)) return null;
                const { cx, cy } = viewBox as { cx: number; cy: number };
                return (
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={cx} y={cy - 6} className="fill-foreground text-xl font-semibold">
                      {String(centerValue ?? "")}
                    </tspan>
                    {centerLabel && (
                      <tspan x={cx} y={cy + 14} className="fill-muted-foreground text-xs">
                        {centerLabel}
                      </tspan>
                    )}
                  </text>
                );
              }}
            />
          )}
        </Pie>
        {showLegend && <ChartLegend content={<ChartLegendContent nameKey="key" />} />}
      </PieChart>
    </ChartContainer>
  );
}
