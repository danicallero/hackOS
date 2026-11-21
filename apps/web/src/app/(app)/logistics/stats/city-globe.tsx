"use client";

import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassPlus";
import { geoDistance, geoOrthographic } from "d3-geo";
import type { HeatmapSeriesOption, ScatterSeriesOption } from "echarts/charts";
import { HeatmapChart, ScatterChart } from "echarts/charts";
import type {
  GeoComponentOption,
  GraphicComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from "echarts/components";
import {
  GeoComponent,
  GraphicComponent,
  TooltipComponent,
  VisualMapContinuousComponent,
} from "echarts/components";
import type { ComposeOption, EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { type CityPlace, loadCityIndex, type PlacedCities, placeCities } from "@/lib/city-geocode";
import { useLocale } from "@/lib/i18n";
import { resolveThemeColor, type StatsChartDatum } from "./stats-chart";

// H27: city answers as a heat map on a globe the viewer can turn. The globe is
// an ECharts geo component drawn through a d3 orthographic projection; the
// heat layer and the city dots share its coordinate system.

type GlobeOption = ComposeOption<
  | GeoComponentOption
  | GraphicComponentOption
  | HeatmapSeriesOption
  | ScatterSeriesOption
  | TooltipComponentOption
  | VisualMapComponentOption
>;

interface GlobePalette {
  ocean: string;
  land: string;
  border: string;
  heat: [string, string];
  dot: string;
  surface: string;
  foreground: string;
  fontFamily: string;
}

/** [longitude, latitude] at the center of the visible hemisphere. */
type Center = [number, number];

const MAP_NAME = "hackos-world";
// Points spread evenly over the whole sphere. Their projection always reaches
// the edge of the disk, so the geo bounding box (and the globe's size) stays
// constant while it rotates; the region itself is never painted.
const SPHERE_REGION = "__sphere";
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const ZOOM_STEP = 1.6;
const DEGREES_PER_PIXEL = 0.35;
const WHOLE_GLOBE_BELOW = 1.5;
// Heat kernel spans about this arc of the sphere, so it follows the zoom
// instead of covering a whole country when the globe is small.
const HEAT_ARC = Math.sin((1.2 * Math.PI) / 180);

echarts.use([
  CanvasRenderer,
  GeoComponent,
  GraphicComponent,
  HeatmapChart,
  ScatterChart,
  TooltipComponent,
  VisualMapContinuousComponent,
]);

let worldPromise: Promise<void> | null = null;
function registerWorld(): Promise<void> {
  worldPromise ??= Promise.all([
    import("world-atlas/countries-110m.json"),
    import("topojson-client"),
  ]).then(([topology, topojson]) => {
    const world = (topology.default ?? topology) as unknown as Parameters<
      typeof topojson.feature
    >[0];
    const countries = topojson.feature(
      world,
      (world.objects as Record<string, Parameters<typeof topojson.feature>[1]>).countries,
    ) as unknown as { features: Array<Record<string, unknown>> };
    echarts.registerMap(MAP_NAME, {
      type: "FeatureCollection",
      features: [
        ...countries.features.map((feature, index) => ({
          ...feature,
          // Region names must be unique; country names are not needed.
          properties: { name: String(index) },
        })),
        {
          type: "Feature",
          properties: { name: SPHERE_REGION },
          geometry: { type: "LineString", coordinates: spherePoints(1200) },
        },
      ],
      // biome-ignore lint/suspicious/noExplicitAny: ECharts' GeoJSON typing rejects plain objects.
    } as any);
  });
  worldPromise.catch(() => {
    worldPromise = null;
  });
  return worldPromise;
}

/** Fibonacci sphere, ordered so consecutive points stay close. */
function spherePoints(count: number): Array<[number, number]> {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / count;
    const lat = (Math.asin(y) * 180) / Math.PI;
    const lon = ((((i * golden * 180) / Math.PI) % 360) + 540) % 360;
    return [lon - 180, lat];
  });
}

/** Weighted center of the answers and a zoom that keeps most of them in view. */
export function initialView(places: CityPlace[]): { center: Center; zoom: number } {
  if (places.length === 0) return { center: [0, 20], zoom: MIN_ZOOM };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const place of places) {
    const lat = (place.lat * Math.PI) / 180;
    const lon = (place.lon * Math.PI) / 180;
    x += place.n * Math.cos(lat) * Math.cos(lon);
    y += place.n * Math.cos(lat) * Math.sin(lon);
    z += place.n * Math.sin(lat);
  }
  const center: Center = [
    (Math.atan2(y, x) * 180) / Math.PI,
    (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
  ];
  // Frame the answers nearest the center that add up to 90% of the people.
  const total = places.reduce((sum, place) => sum + place.n, 0);
  const byDistance = places
    .map((place) => ({ n: place.n, d: geoDistance([place.lon, place.lat], center) }))
    .sort((a, b) => a.d - b.d);
  let covered = 0;
  let radius = 0;
  for (const entry of byDistance) {
    radius = entry.d;
    covered += entry.n;
    if (covered >= total * 0.9) break;
  }
  const visible = Math.min(Math.PI / 2, Math.max((8 * Math.PI) / 180, radius * 1.4));
  const zoom = 1 / Math.sin(visible);
  // Just above 1 the disk would only overflow the panel without showing more.
  return { center, zoom: zoom < WHOLE_GLOBE_BELOW ? MIN_ZOOM : clampZoom(zoom) };
}

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export function CityGlobe({
  data,
  title,
  height = 360,
}: {
  data: StatsChartDatum[];
  title: string;
  height?: number | string;
}) {
  const { t } = useLocale();
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const [placed, setPlaced] = useState<PlacedCities | null>(null);
  const [ready, setReady] = useState(false);
  const view = useRef<{ center: Center; zoom: number }>({ center: [0, 20], zoom: MIN_ZOOM });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const render = useRef<() => void>(() => undefined);
  const rows = useMemo(() => data.map((row) => ({ label: row.label, n: row.n })), [data]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCityIndex(), registerWorld()]).then(
      ([index]) => {
        if (cancelled) return;
        const next = placeCities(index, rows);
        view.current = initialView(next.places);
        setZoom(view.current.zoom);
        setPlaced(next);
        setReady(true);
      },
      // The data list below still shows every answer.
      () => !cancelled && setPlaced({ places: [], unplaced: 0 }),
    );
    return () => {
      cancelled = true;
    };
  }, [rows]);

  useEffect(() => {
    const host = element.current;
    if (!host || !ready || !placed) return;
    const instance = echarts.init(host, undefined, { renderer: "canvas" });
    chart.current = instance;
    let palette = readGlobePalette(host);
    let frame = 0;
    const draw = () => {
      frame = 0;
      if (instance.isDisposed()) return;
      instance.setOption(globeOption(placed.places, view.current, palette, host), {
        lazyUpdate: false,
      });
    };
    render.current = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();

    const resizeObserver = new ResizeObserver(() => {
      if (instance.isDisposed()) return;
      instance.resize();
      render.current();
    });
    resizeObserver.observe(host);
    // H27: next-themes can update the root class after React's theme effect.
    const themeObserver = new MutationObserver(() => {
      palette = readGlobePalette(host);
      render.current();
    });
    themeObserver.observe(host.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    let drag: { x: number; y: number; id: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
      host.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const step = DEGREES_PER_PIXEL / view.current.zoom;
      const [lon, lat] = view.current.center;
      view.current.center = [
        wrapLongitude(lon - (event.clientX - drag.x) * step),
        Math.max(-89, Math.min(89, lat + (event.clientY - drag.y) * step)),
      ];
      drag = { ...drag, x: event.clientX, y: event.clientY };
      render.current();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (drag?.id === event.pointerId) drag = null;
    };
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerUp);

    return () => {
      cancelAnimationFrame(frame);
      render.current = () => undefined;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      instance.dispose();
      chart.current = null;
    };
  }, [placed, ready]);

  const changeZoom = (factor: number) => {
    const next = clampZoom(view.current.zoom * factor);
    view.current.zoom = next;
    setZoom(next);
    render.current();
  };

  return (
    <div className="@container min-w-0">
      <div className="relative min-w-0">
        <div
          ref={element}
          role="img"
          aria-label={title}
          className="min-w-0 cursor-grab touch-none select-none active:cursor-grabbing"
          style={{ height }}
        />
        {ready && (
          <div className="absolute top-2 right-2 flex flex-col gap-1">
            <IconButton
              label={t("globeZoomIn")}
              variant="outline"
              size="icon-sm"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => changeZoom(ZOOM_STEP)}
            >
              <MagnifyingGlassPlusIcon aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t("globeZoomOut")}
              variant="outline"
              size="icon-sm"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => changeZoom(1 / ZOOM_STEP)}
            >
              <MagnifyingGlassMinusIcon aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </div>
      {placed && placed.unplaced > 0 && (
        <p className="text-muted-foreground mt-2 text-sm">
          {t("cityGlobeUnplaced", { count: placed.unplaced })}
        </p>
      )}
      <details className="mt-2 text-sm">
        <summary className="button-interaction cursor-pointer rounded px-1 py-1">
          {t("statsChartData")}
        </summary>
        <ul aria-label={title} className="mt-3 space-y-1">
          {data.map((row) => (
            <li key={row.label} className="break-words">
              {row.label}: {row.n}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const wrapLongitude = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

function globeOption(
  places: CityPlace[],
  { center, zoom }: { center: Center; zoom: number },
  palette: GlobePalette,
  host: HTMLDivElement,
): GlobeOption {
  const projection = geoOrthographic()
    .scale(1)
    .translate([0, 0])
    .clipAngle(90)
    .rotate([-center[0], -center[1]]);
  const size = Math.max(0, Math.min(host.clientWidth, host.clientHeight) - 16);
  const radius = (size / 2) * zoom;
  // Only answers on the visible hemisphere are drawn.
  const visible = places.filter(
    (place) => geoDistance([place.lon, place.lat], center) < Math.PI / 2,
  );
  const max = Math.max(1, ...places.map((place) => place.n));
  const dotSize = (n: number) => 3 + 7 * Math.sqrt(n / max);

  return {
    animation: false,
    textStyle: { fontFamily: palette.fontFamily, color: palette.foreground },
    graphic: [
      {
        type: "circle",
        silent: true,
        z: -10,
        shape: { cx: host.clientWidth / 2, cy: host.clientHeight / 2, r: radius },
        style: { fill: palette.ocean, stroke: palette.border, lineWidth: 1 },
      },
    ],
    geo: {
      map: MAP_NAME,
      projection: {
        project: (point: number[]) =>
          projection(point as [number, number]) ?? [Number.NaN, Number.NaN],
        unproject: (point: number[]) => projection.invert?.(point as [number, number]) ?? [0, 0],
        // biome-ignore lint/suspicious/noExplicitAny: d3 and ECharts stream types describe the same protocol.
        stream: projection.stream as any,
      },
      layoutCenter: ["50%", "50%"],
      layoutSize: size,
      zoom,
      center: [0, 0],
      roam: false,
      silent: true,
      itemStyle: { areaColor: palette.land, borderColor: palette.border, borderWidth: 0.6 },
      regions: [
        {
          name: SPHERE_REGION,
          silent: true,
          itemStyle: { opacity: 0, borderWidth: 0 },
        },
      ],
    },
    visualMap: {
      show: false,
      type: "continuous",
      min: 0,
      max: Math.sqrt(max),
      seriesIndex: 0,
      // Fade from the first heat color itself, not from transparent black (gray halo).
      inRange: { color: [transparent(palette.heat[0]), palette.heat[0], palette.heat[1]] },
    },
    tooltip: {
      trigger: "item",
      confine: true,
      transitionDuration: 0,
      backgroundColor: palette.surface,
      borderColor: palette.border,
      borderWidth: 1,
      borderRadius: 7,
      padding: [8, 10],
      textStyle: { color: palette.foreground, fontFamily: palette.fontFamily, fontSize: 13 },
      formatter: (params: unknown) => {
        const { name, value } = params as { name: string; value: number[] };
        return `${escapeHtml(name)}: <strong>${value[2]}</strong>`;
      },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "geo",
        pointSize: Math.max(4, Math.min(48, radius * HEAT_ARC)),
        blurSize: Math.max(6, Math.min(64, radius * HEAT_ARC * 1.4)),
        silent: true,
        // Square root keeps a few people visible beside the largest city.
        data: visible.map((place) => [place.lon, place.lat, Math.sqrt(place.n)]),
      },
      {
        type: "scatter",
        coordinateSystem: "geo",
        z: 5,
        // ECharts cascades the geo component's tooltip into its series; keep it on here.
        tooltip: { show: true },
        data: visible.map((place) => ({
          name: place.label,
          value: [place.lon, place.lat, place.n],
          symbolSize: dotSize(place.n),
        })),
        itemStyle: { color: palette.dot, borderColor: palette.surface, borderWidth: 1 },
        emphasis: { scale: 1.4 },
      },
    ],
  };
}

const transparent = (rgba: string) => rgba.replace(/,\s*[\d.]+\)$/, ", 0)");

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

function readGlobePalette(host: HTMLDivElement): GlobePalette {
  const canvas = host.ownerDocument.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Chart colors require a 2D canvas context");
  const color = (token: string) => resolveThemeColor(host, token, context);
  // Water stays the darker surface in both themes so land reads as land.
  const dark = host.ownerDocument.documentElement.classList.contains("dark");
  return {
    ocean: color(dark ? "--background" : "--muted"),
    land: color(dark ? "--muted" : "--background"),
    border: color("--border"),
    heat: [color("--chart-4"), color("--chart-3")],
    dot: color("--foreground"),
    surface: color("--popover"),
    foreground: color("--foreground"),
    fontFamily: window.getComputedStyle(host).fontFamily,
  };
}
