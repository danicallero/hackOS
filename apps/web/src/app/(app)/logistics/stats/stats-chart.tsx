"use client";

import { cn } from "@/lib/utils";

export type StatsChartType = "bar" | "pie" | "line";

export interface StatsChartDatum {
  label: string;
  n: number;
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
        <li key={`${row.label}-${row.n}`} className="grid gap-1.5">
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
  const width = 640;
  const height = 220;
  const padding = { top: 16, right: 18, bottom: 26, left: 34 };
  const max = Math.max(...data.map((row) => row.n), 0);
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const points = data.map((row, index) => {
    const x =
      padding.left + (data.length <= 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth);
    const y = padding.top + innerHeight - (max === 0 ? 0 : (row.n / max) * innerHeight);
    return { ...row, x, y };
  });

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        className="h-auto max-h-56 w-full overflow-visible"
      >
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
          stroke="var(--border)"
        />
        <line
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={height - padding.bottom}
          stroke="var(--border)"
        />
        {points.length > 1 && (
          <polyline
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          />
        )}
        {points.map((point) => (
          <g key={`${point.label}-${point.x}`}>
            <circle cx={point.x} cy={point.y} r="4" fill="var(--chart-1)" />
            <text
              x={point.x}
              y={height - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {shortLabel(point.label)}
            </text>
          </g>
        ))}
      </svg>
      <DataKey data={data} />
    </div>
  );
}

function PieChart({ data, title }: { data: StatsChartDatum[]; title: string }) {
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

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)] sm:items-center">
      <svg viewBox="0 0 180 180" role="img" aria-label={title} className="mx-auto size-40">
        {total === 0 ? (
          <circle cx={center} cy={center} r={radius} fill="var(--muted)" />
        ) : slices.length === 1 ? (
          <circle cx={center} cy={center} r={radius} fill={CHART_COLORS[0]} />
        ) : (
          slices.map((slice) => (
            <path
              key={`${slice.label}-${slice.index}`}
              d={slicePath(center, center, radius, slice.start, slice.end)}
              fill={CHART_COLORS[slice.index % CHART_COLORS.length]}
              stroke="var(--background)"
              strokeWidth="2"
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
      <DataKey data={data} colors />
    </div>
  );
}

function DataKey({ data, colors = false }: { data: StatsChartDatum[]; colors?: boolean }) {
  return (
    <ul className={cn("grid gap-x-4 gap-y-2", colors ? "sm:grid-cols-2" : "grid-cols-2")}>
      {data.map((row, index) => (
        <li
          key={`${row.label}-${row.n}`}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-sm"
        >
          {colors && (
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
            />
          )}
          <span className="truncate" title={row.label}>
            {row.label}
          </span>
          <span className="text-muted-foreground tabular-nums">{row.n}</span>
        </li>
      ))}
    </ul>
  );
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
