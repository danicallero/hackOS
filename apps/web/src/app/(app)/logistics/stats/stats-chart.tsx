"use client";

import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from "echarts/charts";
import { BarChart, LineChart as EChartsLineChart, PieChart } from "echarts/charts";
import type {
  AriaComponentOption,
  AxisPointerComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TitleComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import {
  AriaComponent,
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import type { ComposeOption, ECElementEvent, EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

export type StatsChartType = "bar" | "pie" | "line";

export interface StatsChartDatum {
  label: string;
  n: number;
  /** Optional series name for a shared tooltip/data key. */
  series?: string;
}

type StatsChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | AriaComponentOption
  | AxisPointerComponentOption
  | GridComponentOption
  | LegendComponentOption
  | TitleComponentOption
  | TooltipComponentOption
>;

interface ChartPalette {
  colors: string[];
  foreground: string;
  muted: string;
  border: string;
  surface: string;
  fontFamily: string;
}

const CHART_COLOR_TOKENS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];

echarts.use([
  AriaComponent,
  AxisPointerComponent,
  BarChart,
  EChartsLineChart,
  GridComponent,
  LegendComponent,
  PieChart,
  SVGRenderer,
  TitleComponent,
  TooltipComponent,
]);

export function StatsChart({
  data,
  type,
  title,
  height,
}: {
  data: StatsChartDatum[];
  type: StatsChartType;
  title: string;
  height?: number | string;
}) {
  const chartElement = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<EChartsType | null>(null);
  const chartHeight =
    height ?? (type === "bar" ? Math.max(184, Math.min(512, data.length * 40 + 88)) : 312);

  useEffect(() => {
    const element = chartElement.current;
    if (!element) return;

    const chart = echarts.init(element, undefined, { renderer: "svg" });
    chartInstance.current = chart;
    const resizeObserver = new ResizeObserver(() => {
      if (!chart.isDisposed()) chart.resize();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInstance.current;
    const element = chartElement.current;
    if (!chart || !element) return;

    const renderChart = () => {
      if (chart.isDisposed()) return;
      chart.setOption(createStatsChartOption(data, type, title, readChartPalette(element)), {
        notMerge: true,
        lazyUpdate: true,
      });
    };
    renderChart();
    // H27: next-themes can update the root class after React's theme effect.
    const themeObserver = new MutationObserver(renderChart);
    themeObserver.observe(element.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    let activeLegend: string | null = null;
    const updateLegend = (name: string | null) => {
      if (activeLegend === name || chart.isDisposed()) return;
      activeLegend = name;
      chart.setOption(
        {
          legend: {
            formatter: (entry: string) => (entry === name ? `{active|${entry}}` : entry),
          },
        },
        { silent: true },
      );
    };
    const onMouseOver = (event: ECElementEvent) => {
      if (event.componentType !== "series") return;
      updateLegend(type === "pie" ? event.name : (event.seriesName ?? null));
    };
    const clearLegend = () => updateLegend(null);
    chart.on("mouseover", onMouseOver);
    chart.on("mouseout", clearLegend);
    chart.on("globalout", clearLegend);
    return () => {
      themeObserver.disconnect();
      chart.off("mouseover", onMouseOver);
      chart.off("mouseout", clearLegend);
      chart.off("globalout", clearLegend);
    };
  }, [data, title, type]);

  return (
    <div className="@container min-w-0">
      <div
        className={
          type === "bar" && height === undefined
            ? "max-h-[32rem] min-w-0 overflow-y-auto"
            : "min-w-0"
        }
      >
        <div
          ref={chartElement}
          role="img"
          aria-label={title}
          className="min-w-0"
          style={{ height: chartHeight }}
        />
      </div>
      <ul aria-label={title} className="sr-only">
        {data.map((row) => (
          <li key={`${row.series ?? ""}:${row.label}`}>
            {row.series ? `${row.series}: ${row.label}` : row.label}: {row.n}
          </li>
        ))}
      </ul>
    </div>
  );
}

function createStatsChartOption(
  data: StatsChartDatum[],
  type: StatsChartType,
  title: string,
  palette: ChartPalette,
): StatsChartOption {
  const legendCounts = new Map<string, number>();
  for (const row of data) {
    const name =
      type === "line"
        ? row.series || title
        : row.series
          ? `${row.series}: ${row.label}`
          : row.label;
    legendCounts.set(name, (legendCounts.get(name) ?? 0) + row.n);
  }
  const common: StatsChartOption = {
    animation: false,
    color: palette.colors,
    textStyle: { color: palette.foreground, fontFamily: palette.fontFamily },
    aria: {
      enabled: true,
      description: title,
      decal: {
        show: true,
        decals: {
          symbol: "rect",
          symbolSize: 1,
          dashArrayX: [1, 0],
          dashArrayY: [4, 5],
          rotation: -Math.PI / 4,
          color: "rgba(0, 0, 0, 0.22)",
        },
      },
    },
    legend: {
      type: "scroll",
      data: [...legendCounts].map(([name, count]) => ({
        name,
        tooltip: { show: true, formatter: String(count) },
      })),
      bottom: 4,
      left: "center",
      textStyle: {
        color: palette.foreground,
        fontFamily: palette.fontFamily,
        fontSize: 12,
        rich: {
          active: {
            color: palette.foreground,
            fontWeight: 700,
            backgroundColor: palette.border,
            borderRadius: 3,
            padding: [2, 3],
          },
        },
      },
      pageTextStyle: { color: palette.muted },
      pageIconColor: palette.foreground,
      pageIconInactiveColor: palette.border,
      itemWidth: 16,
      itemHeight: 10,
      tooltip: { show: true },
    },
    tooltip: {
      trigger: type === "line" ? "axis" : "item",
      renderMode: "html",
      confine: true,
      transitionDuration: 0,
      hideDelay: 80,
      displayTransition: false,
      backgroundColor: palette.surface,
      borderColor: palette.border,
      borderWidth: 1,
      borderRadius: 7,
      padding: [8, 10],
      textStyle: { color: palette.foreground, fontFamily: palette.fontFamily, fontSize: 13 },
      extraCssText: "box-shadow: 0 4px 14px rgb(15 23 42 / 18%);",
      axisPointer: {
        type: "line",
        axis: type === "bar" ? "y" : "x",
        snap: true,
        // Bars and lines use z=2 and z=3; keep the cursor guide behind them.
        z: 1,
        triggerEmphasis: false,
        animation: false,
        lineStyle: { color: palette.muted, opacity: 0.55, type: "dashed", width: 1 },
      },
    },
  };

  if (type === "pie") {
    const total = data.reduce((sum, row) => sum + row.n, 0);
    const pieData =
      total === 0
        ? [
            {
              name: title,
              value: 1,
              itemStyle: { color: palette.border },
              tooltip: { show: false },
            },
          ]
        : data.map((row, index) => ({
            name: row.series ? `${row.series}: ${row.label}` : row.label,
            value: row.n,
            itemStyle: { color: palette.colors[index % palette.colors.length] },
          }));

    return {
      ...common,
      title: {
        text: String(total),
        left: "center",
        top: "39%",
        textStyle: {
          color: palette.foreground,
          fontFamily: palette.fontFamily,
          fontSize: 24,
          fontWeight: 600,
        },
      },
      series: [
        {
          name: "",
          type: "pie",
          radius: ["46%", "66%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: palette.surface, borderWidth: 3 },
          emphasis: { scale: false, focus: "self" },
          data: pieData,
        },
      ],
    };
  }

  if (type === "bar") {
    const labels = data.map((row) => (row.series ? `${row.series}: ${row.label}` : row.label));
    return {
      ...common,
      grid: { left: 8, right: 38, top: 12, bottom: 44, containLabel: true },
      xAxis: {
        type: "value",
        min: 0,
        max: ({ max }) => Math.max(1, Math.ceil(max)),
        minInterval: 1,
        axisLabel: { color: palette.muted, fontSize: 11, hideOverlap: true },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: palette.border, opacity: 0.55, type: "dashed" } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: labels,
        axisLabel: {
          color: palette.muted,
          fontSize: 11,
          width: 148,
          overflow: "truncate",
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: data.map((row, index) => ({
        name: labels[index],
        type: "bar",
        barGap: "-100%",
        barMaxWidth: 20,
        itemStyle: {
          color: palette.colors[index % palette.colors.length],
          borderRadius: [0, 5, 5, 0],
        },
        label: {
          show: true,
          position: "right",
          color: palette.foreground,
          fontSize: 11,
          fontWeight: 500,
        },
        emphasis: { focus: "series" },
        data: data.map((_, rowIndex) => (rowIndex === index ? row.n : null)),
      })),
    };
  }

  const categories = [...new Set(data.map((row) => row.label))];
  const grouped = new Map<string, Map<string, number>>();
  for (const row of data) {
    const name = row.series || title;
    const values = grouped.get(name) ?? new Map<string, number>();
    values.set(row.label, row.n);
    grouped.set(name, values);
  }
  const seriesNames = [...grouped.keys()];

  return {
    ...common,
    grid: {
      left: 8,
      right: 12,
      top: 16,
      bottom: categories.length > 12 ? 88 : 64,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: categories,
      axisLabel: {
        color: palette.muted,
        fontSize: 11,
        hideOverlap: true,
        rotate: categories.length > 12 ? 35 : 0,
        margin: 12,
      },
      axisLine: { lineStyle: { color: palette.border } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      minInterval: 1,
      axisLabel: { color: palette.muted, fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.border, opacity: 0.55, type: "dashed" } },
    },
    series: seriesNames.map((name, index) => ({
      name,
      type: "line",
      data: categories.map((category) => grouped.get(name)?.get(category) ?? null),
      showSymbol: categories.length <= 28,
      symbol: "circle",
      symbolSize: 7,
      connectNulls: false,
      lineStyle: { color: palette.colors[index % palette.colors.length], width: 2.5 },
      itemStyle: { color: palette.colors[index % palette.colors.length] },
      emphasis: { focus: "series", scale: 1 },
    })),
  };
}

function readChartPalette(element: HTMLDivElement): ChartPalette {
  const computed = window.getComputedStyle(element);
  const canvas = element.ownerDocument.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Chart colors require a 2D canvas context");
  return {
    colors: CHART_COLOR_TOKENS.map((token) => resolveThemeColor(element, token, context)),
    foreground: resolveThemeColor(element, "--foreground", context),
    muted: resolveThemeColor(element, "--muted-foreground", context),
    border: resolveThemeColor(element, "--border", context),
    surface: resolveThemeColor(element, "--popover", context),
    fontFamily: computed.fontFamily,
  };
}

function resolveThemeColor(
  element: HTMLDivElement,
  token: string,
  context: CanvasRenderingContext2D,
): string {
  const probe = element.ownerDocument.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  probe.style.color = `var(${token})`;
  element.append(probe);
  const color = element.ownerDocument.defaultView?.getComputedStyle(probe).color;
  probe.remove();
  return toChartColor(color || window.getComputedStyle(element).color, context);
}

// H27: ECharts' emphasis color parser cannot read CSS color(srgb …) or oklch(…).
function toChartColor(color: string, context: CanvasRenderingContext2D): string {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}
