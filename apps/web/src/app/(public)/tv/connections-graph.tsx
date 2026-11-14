"use client";

import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useElementSize } from "@/hooks/use-element-size";
import {
  apparentRadius,
  buildSequence,
  type Camera,
  cameraFor,
  detectSections,
  type LabelCandidate,
  layoutGraph,
  nodeRadius,
  type Obstacle,
  type Positions,
  type Section,
  sectionIndexById,
  selectLabels,
} from "./connections-layout";

/** Camera timing: a calm overview, then one section at a time. */
export const OVERVIEW_DWELL_MS = 6_000;
export const SECTION_DWELL_MS = 10_000;
export const MOVE_MS = 1_600;

interface Palette {
  company: string;
  edge: string;
  foreground: string;
  background: string;
  fontFamily: string;
  dark: boolean;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Community tint: golden-angle hues, soft enough to stay secondary to the names. */
export function communityColor(index: number, dark: boolean): string {
  if (index < 0) return dark ? "hsl(220 10% 62%)" : "hsl(220 10% 52%)";
  const hue = (index * 137.5 + 210) % 360;
  return dark ? `hsl(${hue} 55% 66%)` : `hsl(${hue} 50% 44%)`;
}

/** Hidden tabs pause the camera; reduced motion keeps the steps but drops the animation. */
function usePlayback(): { visible: boolean; reduced: boolean } {
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setVisible(!document.hidden);
      setReduced(Boolean(query?.matches));
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    query?.addEventListener?.("change", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      query?.removeEventListener?.("change", sync);
    };
  }, []);
  return { visible, reduced };
}

export function ConnectionsGraph({
  nodes,
  edges,
  label,
  overviewLabel,
  sectionLabel,
}: {
  nodes: TvConnectionNode[];
  edges: TvConnectionEdge[];
  label: string;
  overviewLabel: string;
  sectionLabel: (name: string | null, people: number) => string;
}) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { visible, reduced } = usePlayback();
  const previous = useRef<Positions | undefined>(undefined);
  const worldRef = useRef<SVGGElement>(null);
  const camera = useRef<Camera | null>(null);
  const frame = useRef(0);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [cursor, setCursor] = useState(0);
  // The camera the labels were laid out for; they show only while the real camera is there.
  const [rest, setRest] = useState<{ step: number; camera: Camera } | null>(null);
  const [settled, setSettled] = useState(false);

  // Settled once per snapshot; the previous snapshot's positions seed the next.
  const positions = useMemo(() => {
    const next = layoutGraph(nodes, edges, previous.current);
    previous.current = next;
    return next;
  }, [nodes, edges]);
  const sections = useMemo(() => detectSections(nodes, edges), [nodes, edges]);
  const tint = useMemo(() => sectionIndexById(sections), [sections]);
  const sequence = useMemo(() => buildSequence(sections.length), [sections.length]);
  const step = sequence[cursor % sequence.length] ?? -1;
  const section: Section | null = sections[step] ?? null;
  const shownSection: Section | null = rest ? (sections[rest.step] ?? null) : null;

  const unit = Math.max(0.5, Math.min(width, height) / 1000);
  const world = useMemo(() => {
    const pad = Math.min(width, height) * 0.04;
    const map = new Map<string, { x: number; y: number }>();
    for (const [id, p] of positions)
      map.set(id, { x: pad + p.x * (width - pad * 2), y: pad + p.y * (height - pad * 2) });
    return map;
  }, [positions, width, height]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => setPalette(readPalette(element));
    read();
    const observer = new MutationObserver(read);
    observer.observe(element.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [ref]);

  // Advance the sequence; a hidden tab holds still and resumes where it was.
  useEffect(() => {
    if (!visible || sequence.length < 2) return;
    const dwell = step === -1 ? OVERVIEW_DWELL_MS : SECTION_DWELL_MS;
    const timer = window.setTimeout(() => setCursor((c) => c + 1), dwell + MOVE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, sequence.length, step]);

  const target = useMemo(
    () => cameraFor(section, world, width, height),
    [section, world, width, height],
  );

  // Own camera: one transform on the world group, tweened per frame. A poll
  // retargets from the current camera, so it never snaps back mid-move. Company
  // squares are counter-scaled so they grow with the square root of the zoom.
  useLayoutEffect(() => {
    const group = worldRef.current;
    if (!group || width === 0 || height === 0) return;
    const apply = (c: Camera) => {
      camera.current = c;
      group.setAttribute(
        "transform",
        `translate(${width / 2} ${height / 2}) scale(${c.zoom}) translate(${-c.cx} ${-c.cy})`,
      );
      const k = c.zoom ** -0.5;
      for (const el of group.querySelectorAll<SVGElement>("[data-company]")) {
        const x = el.dataset.x;
        const y = el.dataset.y;
        el.setAttribute(
          "transform",
          `translate(${x} ${y}) scale(${k}) translate(${-Number(x)} ${-Number(y)})`,
        );
      }
    };
    const settle = () => {
      setRest({ step, camera: target });
      setSettled(true);
    };
    const from = camera.current;
    const near =
      from &&
      Math.abs(from.cx - target.cx) < 0.5 &&
      Math.abs(from.cy - target.cy) < 0.5 &&
      Math.abs(from.zoom / target.zoom - 1) < 0.01;
    if (!from || reduced || near) {
      apply(target);
      settle();
      return;
    }
    setSettled(false);
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / MOVE_MS);
      const e = ease(t);
      apply({
        zoom: from.zoom * (target.zoom / from.zoom) ** e,
        cx: from.cx + (target.cx - from.cx) * e,
        cy: from.cy + (target.cy - from.cy) * e,
      });
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else settle();
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, step, reduced, width, height]);

  const adjacency = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of edges) {
      map.set(edge.source, [...(map.get(edge.source) ?? []), edge.target]);
      map.set(edge.target, [...(map.get(edge.target) ?? []), edge.source]);
    }
    return map;
  }, [edges]);

  const kinds = useMemo(() => new Map(nodes.map((n) => [n.id, n.kind])), [nodes]);
  // Lit = the section's people and every company they connect to.
  const lit = useMemo(() => {
    if (!section) return null;
    const set = new Set<string>([...section.people, ...section.companies]);
    for (const id of section.people)
      for (const other of adjacency.get(id) ?? [])
        if (kinds.get(other) === "company") set.add(other);
    return set;
  }, [section, adjacency, kinds]);
  const members = useMemo(
    () => (section ? new Set([...section.people, ...section.companies]) : null),
    [section],
  );

  const fade = reduced ? undefined : `opacity ${MOVE_MS}ms ease-in-out`;
  const dark = palette?.dark ?? false;

  const edgeEls = useMemo(() => {
    if (!palette) return null;
    return edges.map((edge) => {
      const a = world.get(edge.source);
      const b = world.get(edge.target);
      if (!a || !b) return null;
      const mx = (a.x + b.x) / 2 - (b.y - a.y) * 0.12;
      const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.12;
      const on = lit
        ? lit.has(edge.source) &&
          lit.has(edge.target) &&
          (Boolean(members?.has(edge.source)) || Boolean(members?.has(edge.target)))
        : false;
      return (
        <path
          key={`${edge.source}|${edge.target}`}
          d={`M${a.x} ${a.y}Q${mx} ${my} ${b.x} ${b.y}`}
          fill="none"
          stroke={palette.edge}
          strokeWidth={on ? 1.6 * unit : 0.8 * unit}
          vectorEffect="non-scaling-stroke"
          style={{ opacity: lit ? (on ? 0.55 : 0.03) : 0.14, transition: fade }}
        />
      );
    });
  }, [edges, world, lit, members, palette, unit, fade]);

  const nodeEls = useMemo(() => {
    if (!palette) return null;
    return [...nodes]
      .sort(
        (a, b) =>
          Number(b.kind === "company") - Number(a.kind === "company") ||
          a.degree - b.degree ||
          (a.id < b.id ? -1 : 1),
      )
      .map((node) => {
        const p = world.get(node.id);
        if (!p) return null;
        const r = nodeRadius(node.degree, node.kind, unit);
        const opacity = lit ? (lit.has(node.id) ? 1 : 0.1) : 0.85;
        if (node.kind === "company")
          return (
            <rect
              key={node.id}
              data-company=""
              data-x={p.x}
              data-y={p.y}
              x={p.x - r}
              y={p.y - r}
              width={r * 2}
              height={r * 2}
              rx={r * 0.3}
              fill={palette.company}
              stroke={palette.foreground}
              strokeWidth={2 * unit}
              vectorEffect="non-scaling-stroke"
              style={{ opacity, transition: fade }}
            />
          );
        return (
          <circle
            key={node.id}
            cx={p.x}
            cy={p.y}
            r={r}
            fill={communityColor(tint.get(node.id) ?? -1, dark)}
            style={{ opacity, transition: fade }}
          />
        );
      });
  }, [nodes, world, lit, palette, tint, dark, unit, fade]);

  // Labels are laid out for the camera at rest, in the same projection as the dots.
  const placed = useMemo(() => {
    const cam = rest?.camera ?? cameraFor(null, world, width, height);
    const project = (id: string) => {
      const p = world.get(id);
      return p
        ? { x: (p.x - cam.cx) * cam.zoom + width / 2, y: (p.y - cam.cy) * cam.zoom + height / 2 }
        : null;
    };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const candidates: LabelCandidate[] = [];
    const obstacles: Obstacle[] = [];
    const ids = shownSection
      ? new Set([
          ...shownSection.people,
          ...shownSection.companies,
          ...shownSection.people.flatMap((id) =>
            (adjacency.get(id) ?? []).filter((o) => kinds.get(o) === "company"),
          ),
        ])
      : new Set(nodes.filter((n) => n.kind === "company").map((n) => n.id));
    for (const id of ids) {
      const node = byId.get(id);
      const at = project(id);
      if (!node || !at) continue;
      const r = apparentRadius(node.degree, node.kind, unit, cam.zoom);
      obstacles.push({ id, x: at.x, y: at.y, r });
      if (!node.label?.trim()) continue;
      candidates.push({
        id,
        text: node.label.trim(),
        x: at.x,
        y: at.y,
        r,
        priority: node.degree + (node.kind === "company" ? 1000 : 0),
      });
    }
    const fontSize = (shownSection ? 28 : 26) * unit;
    return {
      labels: selectLabels(candidates, width, height, fontSize, shownSection ? 20 : 14, obstacles),
      fontSize,
    };
  }, [rest, shownSection, world, width, height, nodes, adjacency, kinds, unit]);

  const people = shownSection?.people.length ?? 0;
  const caption = shownSection ? sectionLabel(shownSection.title, people) : overviewLabel;

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className="relative size-full min-h-0 min-w-0 overflow-hidden"
      data-testid="connections-graph"
    >
      {palette && width > 0 && height > 0 && (
        <svg width={width} height={height} aria-hidden="true" className="absolute inset-0">
          <g ref={worldRef}>
            <g>{edgeEls}</g>
            <g>{nodeEls}</g>
          </g>
          <g
            style={{ opacity: settled ? 1 : 0, transition: reduced ? undefined : "opacity 400ms" }}
            fontFamily={palette.fontFamily}
            fontSize={placed.fontSize}
            fontWeight={700}
            fill={palette.foreground}
            stroke={palette.background}
            strokeWidth={placed.fontSize * 0.3}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {placed.labels.map((l) => (
              <text key={l.id} x={l.x} y={l.y} dy="0.35em" textAnchor={l.anchor}>
                {l.text}
              </text>
            ))}
          </g>
        </svg>
      )}
      <p
        className="bg-background text-foreground border-foreground/30 absolute bottom-[0.5em] left-[0.5em] max-w-[90%] truncate rounded-[0.4em] border-2 px-[0.8em] py-[0.35em] text-[2.6em] leading-tight font-bold"
        style={{ opacity: settled ? 1 : 0, transition: reduced ? undefined : "opacity 400ms" }}
        data-testid="connections-caption"
      >
        {caption}
      </p>
    </div>
  );
}

function readPalette(element: HTMLElement): Palette {
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
  const foreground = color("--foreground");
  return {
    company: color("--chart-3"),
    edge: color("--muted-foreground"),
    foreground,
    background: color("--background"),
    fontFamily: getComputedStyle(element).fontFamily,
    dark: luminance(foreground) > 0.5,
  };
}

function luminance(rgba: string): number {
  const [r, g, b] = (rgba.match(/[\d.]+/g) ?? []).map(Number);
  return (0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0)) / 255;
}

// SVG accepts CSS colours, but round-trip through a canvas so `color(srgb …)` / oklch resolve to rgba.
function toRgba(color: string, context: CanvasRenderingContext2D | null): string {
  if (!context) return color;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}
