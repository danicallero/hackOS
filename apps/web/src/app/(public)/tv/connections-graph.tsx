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
  selectLabels,
} from "./connections-layout";

/** Camera timing: a calm overview, then one section at a time. */
export const OVERVIEW_DWELL_MS = 6_000;
export const SECTION_DWELL_MS = 10_000;
export const MOVE_MS = 1_600;

interface Palette {
  person: string;
  edge: string;
  foreground: string;
  /** Neutral disc behind a company without a (loadable) logo. */
  neutral: string;
  neutralText: string;
  /** Halo colour around the label text, matching the canvas edge. */
  canvasEdge: string;
  canvas: string;
  fontFamily: string;
  dark: boolean;
}

/** org-roam-ui look: dark hero canvas with one quiet node colour; a calm light twin. */
const LOOK = {
  dark: {
    person: "#9aa8ff",
    edge: "#a9b4e8",
    neutral: "#2b2f45",
    neutralText: "#dfe4ff",
    canvasEdge: "#0b0c14",
    canvas: "radial-gradient(ellipse at 50% 45%, #1b1e2e 0%, #11121c 55%, #0b0c14 100%)",
  },
  light: {
    person: "#4a5bd0",
    edge: "#5a64a0",
    neutral: "#e3e6f4",
    neutralText: "#2b3170",
    canvasEdge: "#eef0f8",
    canvas: "radial-gradient(ellipse at 50% 45%, #ffffff 0%, #f6f7fc 55%, #eceef7 100%)",
  },
} as const;

/**
 * The logo to draw for a company: the negative variant on dark canvases, the
 * plain one on light; a variant that failed to load falls back to the other
 * (same rule as SponsorLogo). Null = no usable logo, draw the neutral disc.
 */
export function logoCandidates(node: TvConnectionNode, dark: boolean): string[] {
  const urls = dark ? [node.logoNegativeUrl, node.logoUrl] : [node.logoUrl];
  return urls.filter((u, i, all): u is string => Boolean(u) && all.indexOf(u) === i);
}

/** Probes each company's logo off-DOM so a dead URL falls back instead of drawing a broken image. */
function useResolvedLogos(nodes: TvConnectionNode[], dark: boolean): Map<string, string | null> {
  const [resolved, setResolved] = useState<Map<string, string | null>>(new Map());
  const started = useRef(new Set<string>());
  useEffect(() => {
    for (const node of nodes) {
      if (node.kind !== "company") continue;
      const key = `${dark ? "d" : "l"}|${node.id}|${node.logoUrl}|${node.logoNegativeUrl}`;
      if (started.current.has(key)) continue;
      started.current.add(key);
      const done = (url: string | null) =>
        setResolved((m) => new Map(m).set(`${dark}|${node.id}`, url));
      const urls = logoCandidates(node, dark);
      const attempt = (i: number) => {
        const url = urls[i];
        if (!url) return done(null);
        const img = new Image();
        img.onload = () => done(url);
        img.onerror = () => attempt(i + 1);
        img.src = url;
      };
      attempt(0);
    }
  }, [nodes, dark]);
  return resolved;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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
}: {
  nodes: TvConnectionNode[];
  edges: TvConnectionEdge[];
  label: string;
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
  const logos = useResolvedLogos(nodes, dark);

  const edgeEls = useMemo(() => {
    if (!palette) return null;
    return edges.map((edge) => {
      const a = world.get(edge.source);
      const b = world.get(edge.target);
      if (!a || !b) return null;
      const mx = (a.x + b.x) / 2 - (b.y - a.y) * 0.06;
      const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.06;
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
          strokeWidth={on ? 1.4 * unit : 0.7 * unit}
          vectorEffect="non-scaling-stroke"
          style={{ opacity: lit ? (on ? 0.6 : 0.03) : palette.dark ? 0.2 : 0.26, transition: fade }}
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
        const opacity = lit ? (lit.has(node.id) ? 1 : 0.1) : 0.92;
        if (node.kind === "company") {
          const logo = logos.get(`${dark}|${node.id}`);
          const wanted = logoCandidates(node, dark).length > 0;
          // Still probing: draw nothing yet rather than flashing the fallback.
          if (wanted && logo === undefined) return null;
          return (
            <g
              key={node.id}
              data-company=""
              data-x={p.x}
              data-y={p.y}
              style={{ opacity, transition: fade }}
            >
              {logo ? (
                <image
                  href={logo}
                  x={p.x - r}
                  y={p.y - r}
                  width={r * 2}
                  height={r * 2}
                  preserveAspectRatio="xMidYMid meet"
                />
              ) : (
                <>
                  <circle cx={p.x} cy={p.y} r={r} fill={palette.neutral} />
                  <text
                    x={p.x}
                    y={p.y}
                    dy="0.35em"
                    textAnchor="middle"
                    fontSize={r * 1.1}
                    fontWeight={700}
                    fontFamily={palette.fontFamily}
                    fill={palette.neutralText}
                  >
                    {Array.from(node.label.trim())[0]?.toUpperCase() ?? ""}
                  </text>
                </>
              )}
            </g>
          );
        }
        return (
          <g key={node.id} style={{ opacity, transition: fade }}>
            <circle cx={p.x} cy={p.y} r={r * 2.4} fill="url(#tv-graph-glow)" />
            <circle cx={p.x} cy={p.y} r={r} fill={palette.person} />
          </g>
        );
      });
  }, [nodes, world, lit, palette, logos, dark, unit, fade]);

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

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className="relative size-full min-h-0 min-w-0 overflow-hidden"
      style={{ background: palette?.canvas }}
      data-testid="connections-graph"
    >
      {palette && width > 0 && height > 0 && (
        <svg width={width} height={height} aria-hidden="true" className="absolute inset-0">
          <defs>
            <radialGradient id="tv-graph-glow">
              <stop offset="0%" stopColor={palette.person} stopOpacity={dark ? 0.3 : 0.16} />
              <stop offset="45%" stopColor={palette.person} stopOpacity={dark ? 0.08 : 0.04} />
              <stop offset="100%" stopColor={palette.person} stopOpacity={0} />
            </radialGradient>
          </defs>
          <g ref={worldRef}>
            <g>{edgeEls}</g>
            <g>{nodeEls}</g>
          </g>
          <g
            style={{ opacity: settled ? 1 : 0, transition: reduced ? undefined : "opacity 400ms" }}
            fontFamily={palette.fontFamily}
            fontSize={placed.fontSize}
            fontWeight={600}
            fill={palette.foreground}
            stroke={palette.canvasEdge}
            strokeWidth={placed.fontSize * 0.28}
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
  const dark = luminance(foreground) > 0.5;
  return {
    ...LOOK[dark ? "dark" : "light"],
    foreground: dark ? "#e8ebff" : "#1d2150",
    fontFamily: getComputedStyle(element).fontFamily,
    dark,
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
