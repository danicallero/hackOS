import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartCard } from "./chart-card";
import type { StatsChartDatum, StatsChartType } from "./stats-chart";

const drawn = vi.hoisted(() => ({ chart: [] as string[], globe: [] as string[] }));
vi.mock("./stats-chart", () => ({
  StatsChart: ({ data, note }: { data: StatsChartDatum[]; note?: ReactNode }) => {
    drawn.chart = data.map((row) => row.label);
    return note ?? null;
  },
}));
vi.mock("./city-globe", () => ({
  CityGlobe: ({ data }: { data: StatsChartDatum[] }) => {
    drawn.globe = data.map((row) => row.label);
    return null;
  },
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values?: { count?: number }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const rows: StatsChartDatum[] = [
  { label: "Vigo", n: 5 },
  { label: "Lugo", n: 2 },
  { label: "Xove", n: 1 },
  { label: "Foz", n: 1 },
];
let root: Root | null = null;
const container = document.createElement("div");
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

function mount(chartType: StatsChartType, allowGlobe: boolean, data = rows) {
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <ChartCard title="Origin" rows={data} chartType={chartType} allowGlobe={allowGlobe} />,
    ),
  );
}

describe("ChartCard city answers (H27)", () => {
  it("leaves one-person cities to the globe and counts them under the bars", () => {
    mount("bar", true);
    expect(drawn.chart).toEqual(["Vigo", "Lugo"]);
    expect(container.textContent).toContain("cityChartSingles:2");
  });

  it("puts every city on the globe", () => {
    mount("globe", true);
    expect(drawn.globe).toEqual(["Vigo", "Lugo", "Xove", "Foz"]);
    expect(container.textContent).not.toContain("cityChartSingles");
  });

  it("keeps every row when no city has two people, and for other questions", () => {
    mount("bar", true, [rows[2] as StatsChartDatum, rows[3] as StatsChartDatum]);
    expect(drawn.chart).toEqual(["Xove", "Foz"]);
    act(() => root?.unmount());
    mount("bar", false);
    expect(drawn.chart).toEqual(["Vigo", "Lugo", "Xove", "Foz"]);
    expect(container.textContent).not.toContain("cityChartSingles");
  });
});
