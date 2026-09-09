"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type StatsChartType = "bar" | "pie" | "line";

export interface StatsChartDatum {
  label: string;
  n: number;
  /** Optional series name for a shared tooltip/data key. */
  series?: string;
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function StatsChart({
  data,
  type,
  title,
}: {
  data: StatsChartDatum[];
  type: StatsChartType;
  title: string;
}) {
  if (type === "pie") return <PieChart data={data} title={title} />;
  if (type === "line") return <LineChart data={data} title={title} />;
  return <BarChart data={data} title={title} />;
}

function BarChart({ data, title }: { data: StatsChartDatum[]; title: string }) {
  const max = Math.max(...data.map((row) => row.n), 0);
  return (
    <ul className="space-y-3" aria-label={title}>
      {data.map((row, index) => (
        <li key={`${row.label}-${row.series ?? ""}-${row.n}`} className="grid gap-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <span className="truncate text-sm font-medium" title={row.label}>
              {row.label}
            </span>
            <span className="text-muted-foreground tabular-nums text-sm">{row.n}</span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{
                width: `${max === 0 ? 0 : (row.n / max) * 100}%`,
                backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function LineChart({ data, title }: { data: StatsChartDatum[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 640;
  const height = 250;
  const padding = { top: 18, right: 18, bottom: 42, left: 48 };
  const max = Math.max(...data.map((row) => row.n), 0);
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const scaleMax = Math.max(max, 1);
  const xLabels = [...new Set(data.map((row) => row.label))];
  const xIndex = new Map(xLabels.map((label, index) => [label, index]));
  const points = data.map((row) => {
    const x =
      padding.left +
      (xLabels.length <= 1
        ? innerWidth / 2
        : (xIndex.get(row.label)! / (xLabels.length - 1)) * innerWidth);
    const y = padding.top + innerHeight - (row.n / scaleMax) * innerHeight;
    return { ...row, x, y };
  });
  const active = activeIndex === null ? null : points[activeIndex];
  const lineSeries = [...new Set(data.map((row) => row.series ?? ""))].map((series) => ({
    series,
    points: points.filter((point) => (point.series ?? "") === series).sort((a, b) => a.x - b.x),
  }));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: Math.round(scaleMax * ratio * 10) / 10,
    y: padding.top + innerHeight - innerHeight * ratio,
  }));

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
          className="h-auto max-h-64 w-full overflow-visible"
        >
          {yTicks.map((tick) => (
            <g key={tick.y}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={tick.y}
                y2={tick.y}
                stroke="var(--border)"
                strokeDasharray="3 4"
              />
              <text
                x={padding.left - 8}
                y={tick.y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {tick.value}
              </text>
            </g>
          ))}
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={height - padding.bottom}
            y2={height - padding.bottom}
            stroke="var(--border)"
          />
          {lineSeries.map(
            (series, index) =>
              series.points.length > 1 && (
                <polyline
                  key={series.series || "default"}
                  fill="none"
                  stroke={CHART_COLORS[index % CHART_COLORS.length]}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={series.points.map((point) => `${point.x},${point.y}`).join(" ")}
                />
              ),
          )}
          {active && (
            <line
              x1={active.x}
              x2={active.x}
              y1={padding.top}
              y2={height - padding.bottom}
              stroke="var(--chart-1)"
              strokeDasharray="4 4"
            />
          )}
          {points.map((point, index) => (
            <g key={`${point.label}-${point.series ?? ""}-${point.x}-${point.y}`}>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG points mirror the keyboard data key below. */}
              <circle
                cx={point.x}
                cy={point.y}
                r={activeIndex === index ? 7 : 4}
                fill={
                  CHART_COLORS[
                    lineSeries.findIndex((series) => series.series === (point.series ?? "")) %
                      CHART_COLORS.length
                  ]
                }
                stroke={activeIndex === index ? "var(--background)" : undefined}
                strokeWidth={activeIndex === index ? 3 : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
              />
            </g>
          ))}
          {xLabels.map((label, index) => {
            const x =
              padding.left +
              (xLabels.length <= 1 ? innerWidth / 2 : (index / (xLabels.length - 1)) * innerWidth);
            return (
              <text
                key={label}
                x={x}
                y={height - 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {shortLabel(label)}
              </text>
            );
          })}
        </svg>
        {active && (
          <div className="bg-popover text-popover-foreground pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-md border px-3 py-2 text-xs shadow-sm">
            <div className="font-medium">{active.label}</div>
            <div className="tabular-nums">
              {active.series ? `${active.series}: ` : ""}
              {active.n}
            </div>
          </div>
        )}
      </div>
      <DataKey
        data={data}
        colors={data.some((row) => row.series !== undefined)}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
      />
    </div>
  );
}

function PieChart({ data, title }: { data: StatsChartDatum[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const total = data.reduce((sum, row) => sum + row.n, 0);
  const radius = 72;
  const center = 90;
  let angle = -Math.PI / 2;
  const slices = data.map((row, index) => {
    const nextAngle = angle + (total === 0 ? 0 : (row.n / total) * Math.PI * 2);
    const slice = { ...row, index, start: angle, end: nextAngle };
    angle = nextAngle;
    return slice;
  });
  const active = activeIndex === null ? null : slices[activeIndex];

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)] sm:items-center">
      <div className="relative mx-auto size-40">
        <svg viewBox="0 0 180 180" role="img" aria-label={title} className="size-40">
          {total === 0 ? (
            <circle cx={center} cy={center} r={radius} fill="var(--muted)" />
          ) : slices.length === 1 ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG slices mirror the keyboard data key below.
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill={CHART_COLORS[0]}
              onMouseEnter={() => setActiveIndex(0)}
              onMouseLeave={() => setActiveIndex(null)}
            />
          ) : (
            slices.map((slice) => (
              // biome-ignore lint/a11y/noStaticElementInteractions: SVG slices mirror the keyboard data key below.
              <path
                key={`${slice.label}-${slice.index}`}
                d={slicePath(center, center, radius, slice.start, slice.end)}
                fill={CHART_COLORS[slice.index % CHART_COLORS.length]}
                stroke="var(--background)"
                strokeWidth={activeIndex === slice.index ? 4 : 2}
                onMouseEnter={() => setActiveIndex(slice.index)}
                onMouseLeave={() => setActiveIndex(null)}
              />
            ))
          )}
          <circle cx={center} cy={center} r="34" fill="var(--background)" />
          <text
            x={center}
            y={center + 5}
            textAnchor="middle"
            className="fill-foreground text-xl font-semibold tabular-nums"
          >
            {total}
          </text>
        </svg>
        {active && (
          <div className="bg-popover text-popover-foreground pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-sm">
            {pieSliceLabel(active, total)}
          </div>
        )}
      </div>
      <DataKey
        data={data}
        total={total}
        colors
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
      />
    </div>
  );
}

function DataKey({
  data,
  colors = false,
  total,
  activeIndex,
  onActiveIndexChange,
}: {
  data: StatsChartDatum[];
  colors?: boolean;
  total?: number;
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
}) {
  return (
    <ul className={cn("grid gap-x-4 gap-y-2", colors ? "sm:grid-cols-2" : "grid-cols-2")}>
      {data.map((row, index) => (
        <li key={`${row.label}-${row.series ?? ""}-${row.n}`} className="text-sm">
          <button
            type="button"
            className={cn(
              "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeIndex === index && "bg-muted",
            )}
            onMouseEnter={() => onActiveIndexChange?.(index)}
            onMouseLeave={() => onActiveIndexChange?.(null)}
            onFocus={() => onActiveIndexChange?.(index)}
            onBlur={() => onActiveIndexChange?.(null)}
          >
            {colors && (
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
            )}
            <span
              className="truncate"
              title={row.series ? `${row.series}: ${row.label}` : row.label}
            >
              {row.series ? `${row.series}: ${row.label}` : row.label}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {row.n}
              {total !== undefined && total > 0 && (
                <span className="ml-1 text-xs">({((row.n / total) * 100).toFixed(1)}%)</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function pieSliceLabel(slice: StatsChartDatum, total: number): string {
  const percentage = total > 0 ? ` · ${((slice.n / total) * 100).toFixed(1)}%` : "";
  return `${slice.label}: ${slice.n}${percentage}`;
}

function slicePath(cx: number, cy: number, radius: number, start: number, end: number): string {
  const startPoint = polarPoint(cx, cy, radius, end);
  const endPoint = polarPoint(cx, cy, radius, start);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArc} 0 ${endPoint.x} ${endPoint.y} Z`;
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function shortLabel(value: string): string {
  return value.length > 12 ? `${value.slice(0, 10)}…` : value;
}
