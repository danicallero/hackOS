"use client";

import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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

export interface TrendSeries {
  /** Key of the value in each data row. */
  key: string;
  label?: string;
  tone?: Tone;
}

/**
 * Time-series chart (area or line), one or many series. Data is an array of
 * rows; `index` is the x-axis key and `series` maps value keys to labels and
 * tones. Same component for every trend graph (monitoring, registrations over
 * time, queue throughput…).
 */
export function TrendChart({
  data,
  index,
  series,
  type = "area",
  height = 200,
  showGrid = true,
  showXAxis = true,
  showYAxis = false,
  showLegend = false,
  className,
}: {
  data: Record<string, unknown>[];
  index: string;
  series: TrendSeries[];
  type?: "area" | "line";
  height?: number;
  showGrid?: boolean;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showLegend?: boolean;
  className?: string;
}) {
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label ?? s.key, color: TONE_FG[s.tone ?? "brand"] }]),
  );
  const Chart = type === "area" ? AreaChart : LineChart;

  return (
    <ChartContainer config={config} className={cn("w-full", className)} style={{ height }}>
      <Chart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        {showGrid && <CartesianGrid vertical={false} strokeDasharray="3 3" />}
        {showXAxis && (
          <XAxis
            dataKey={index}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            className="text-xs"
          />
        )}
        {showYAxis && <YAxis tickLine={false} axisLine={false} width={36} className="text-xs" />}
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.map((s) =>
          type === "area" ? (
            <defs key={`def-${s.key}`}>
              <linearGradient id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={`var(--color-${s.key})`} stopOpacity={0.35} />
                <stop offset="95%" stopColor={`var(--color-${s.key})`} stopOpacity={0.03} />
              </linearGradient>
            </defs>
          ) : null,
        )}
        {series.map((s) =>
          type === "area" ? (
            <Area
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              fill={`url(#fill-${s.key})`}
              stackId="a"
            />
          ) : (
            <Line
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              dot={false}
            />
          ),
        )}
        {showLegend && <ChartLegend content={<ChartLegendContent />} />}
      </Chart>
    </ChartContainer>
  );
}
