"use client";

import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { GraphChart } from "echarts/charts";
import { AriaComponent } from "echarts/components";
import type { EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import { LabelLayout } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef, useState } from "react";
import { useElementSize } from "@/hooks/use-element-size";
import {
  buildFocusGroups,
  labelledNodeIds,
  layoutGraph,
  type Positions,
} from "./connections-layout";
import { buildConnectionsOption, type ConnectionsPalette } from "./connections-option";

echarts.use([AriaComponent, GraphChart, LabelLayout, SVGRenderer]);

/** How long each neighbourhood stays highlighted. */
export const FOCUS_ROTATION_MS = 9_000;

/** Rotation pauses while the tab is hidden or the viewer asks for reduced motion. */
function useFocusIndex(count: number): number | null {
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(true);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const sync = () => setActive(!document.hidden && !reduced?.matches);
    sync();
    document.addEventListener("visibilitychange", sync);
    reduced?.addEventListener?.("change", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      reduced?.removeEventListener?.("change", sync);
    };
  }, []);
  useEffect(() => {
    if (!active || count === 0) return;
    const timer = window.setInterval(() => setIndex((i) => i + 1), FOCUS_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [active, count]);
  return active && count > 0 ? index % count : null;
}

export function ConnectionsGraph({
  nodes,
  edges,
  label,
}: {
  nodes: TvConnectionNode[];
  edges: TvConnectionEdge[];
  label: string;
}) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const chart = useRef<EChartsType | null>(null);
  const previous = useRef<Positions | undefined>(undefined);
  const [themeTick, setThemeTick] = useState(0);

  // Settled once per snapshot; the previous snapshot's positions seed the next.
  const positions = useMemo(() => {
    const next = layoutGraph(nodes, edges, previous.current);
    previous.current = next;
    return next;
  }, [nodes, edges]);
  const labelled = useMemo(() => labelledNodeIds(nodes), [nodes]);
  const groups = useMemo(() => buildFocusGroups(nodes, edges), [nodes, edges]);
  const focusIndex = useFocusIndex(groups.length);
  const focus = focusIndex === null ? null : (groups[focusIndex] ?? null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const instance = echarts.init(element, undefined, { renderer: "svg" });
    chart.current = instance;
    const themeObserver = new MutationObserver(() => setThemeTick((tick) => tick + 1));
    themeObserver.observe(element.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      themeObserver.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [ref]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: themeTick re-reads CSS colours after a theme switch.
  useEffect(() => {
    const instance = chart.current;
    const element = ref.current;
    if (!instance || !element || width === 0 || height === 0 || instance.isDisposed()) return;
    instance.resize({ width, height });
    const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    instance.setOption(
      buildConnectionsOption({
        nodes,
        edges,
        positions,
        width,
        height,
        palette: readPalette(element),
        labelled,
        focus,
        animate,
      }),
    );
  }, [ref, nodes, edges, positions, width, height, labelled, focus, themeTick]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className="size-full min-h-0 min-w-0"
      data-testid="connections-graph"
    />
  );
}

function readPalette(element: HTMLElement): ConnectionsPalette {
  const context = element.ownerDocument.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });
  const color = (token: string) => {
    const probe = element.ownerDocument.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
    probe.style.color = `var(${token})`;
    element.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return toRgba(resolved, context);
  };
  return {
    person: color("--chart-1"),
    company: color("--chart-3"),
    edge: color("--muted-foreground"),
    foreground: color("--foreground"),
    fontFamily: getComputedStyle(element).fontFamily,
  };
}

// ECharts cannot read CSS color(srgb …) / oklch(…); round-trip through a canvas.
function toRgba(color: string, context: CanvasRenderingContext2D | null): string {
  if (!context) return color;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}
