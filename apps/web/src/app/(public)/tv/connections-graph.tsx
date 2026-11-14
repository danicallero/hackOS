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
/** Only this many of a section's most-connected people are named; the overview names nobody. */
export const TOP_LABELS = 4;
/** Labels fade out this long before the camera starts to move. */
export const LABEL_LEAD_MS = 300;

/**
 * org-roam-ui look, always dark: the wall graph draws its own flat canvas whatever
 * the OS or app theme, so logos use their negative variant and nothing needs a
 * light twin. One quiet node colour, no glow, no gradient.
 */
const PALETTE = {
  person: "#9aa8ff",
  edge: "#a9b4e8",
  foreground: "#e8ebff",
  /** Light disc + ring behind a company without a (loadable) logo. */
  neutral: "#e8ebff",
  neutralRing: "#9aa8ff",
  neutralText: "#161a33",
  canvas: "#0b0c14",
  dark: true,
} as const;
type Palette = typeof PALETTE;

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
  // Current dim/focus values of every node and edge. They are animated by the camera
  // loop straight on the DOM nodes (no React render per frame); React only reads them
  // as the initial style of an element it (re)creates, so a re-render never resets a fade.
  const focus = useRef({
    nodes: new Map<string, number>(),
    edges: new Map<string, { o: number; w: number }>(),
  });
  const palette: Palette = PALETTE;
  const [cursor, setCursor] = useState(0);
  // The camera the labels were laid out for; they show only while the real camera is there.
  const [rest, setRest] = useState<{ step: number; camera: Camera } | null>(null);
  const [settled, setSettled] = useState(false);
  // Nothing is painted until the first camera is in place.
  const [shown, setShown] = useState(false);

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
  // Rescale the settled layout to its own bounds, padded by the biggest logo, so the
  // first frame is centred and nothing is clipped whatever shape the force pass took.
  const world = useMemo(() => {
    const pad = Math.min(
      Math.max(nodeRadius(0, "company", unit) * 1.6, 8),
      Math.min(width, height) * 0.2,
    );
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const map = new Map<string, { x: number; y: number }>();
    for (const [id, p] of positions)
      map.set(id, {
        x: pad + ((p.x - minX) / spanX) * (width - pad * 2),
        y: pad + ((p.y - minY) / spanY) * (height - pad * 2),
      });
    return map;
  }, [positions, width, height, unit]);

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

  const dark = true;
  const logos = useResolvedLogos(nodes, dark);
  const degrees = useMemo(() => new Map(nodes.map((n) => [n.id, n.degree])), [nodes]);

  // Own camera: ONE rAF loop that writes the world transform, the company counter-scale
  // and every dim/focus opacity straight onto stable DOM nodes. Nothing here renders
  // React, so a transition costs the browser one style/paint pass per frame, not a
  // reconciliation of ~1500 elements. A poll retargets from the current camera and
  // current opacities, so it never snaps back mid-move.
  // `logos` and `world` re-key the effect when elements are (re)drawn, so new DOM nodes get the camera and focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    const group = worldRef.current;
    if (!group || width === 0 || height === 0) return;
    const store = focus.current;
    const nodeEntries = [...group.querySelectorAll<SVGElement>("[data-nid]")].map((el) => {
      const id = el.dataset.nid as string;
      const to = lit ? (lit.has(id) ? 1 : 0.1) : 0.92;
      return { el, id, from: store.nodes.get(id) ?? Number(el.style.opacity || to), to };
    });
    const edgeEntries = [...group.querySelectorAll<SVGElement>("[data-eid]")].map((el) => {
      const a = el.dataset.a as string;
      const b = el.dataset.b as string;
      const hub = Math.sqrt(Math.max(degrees.get(a) ?? 1, degrees.get(b) ?? 1));
      const on = lit
        ? lit.has(a) && lit.has(b) && Boolean(members?.has(a) || members?.has(b))
        : false;
      const to = {
        o: lit ? (on ? 0.75 / (1 + hub * 0.12) : 0.03) : 0.34 / (1 + hub * 0.25),
        w: (on ? 1.4 : 0.7) * unit,
      };
      const key = `${a}|${b}`;
      const from = store.edges.get(key) ?? { o: Number(el.style.opacity || to.o), w: to.w };
      return { el, key, from, to };
    });
    const companies = [...group.querySelectorAll<SVGElement>("[data-company]")];
    const paintCamera = (c: Camera) => {
      camera.current = c;
      group.setAttribute(
        "transform",
        `translate(${width / 2} ${height / 2}) scale(${c.zoom}) translate(${-c.cx} ${-c.cy})`,
      );
      const k = c.zoom ** -0.5;
      for (const el of companies) {
        const x = el.dataset.x;
        const y = el.dataset.y;
        el.setAttribute(
          "transform",
          `translate(${x} ${y}) scale(${k}) translate(${-Number(x)} ${-Number(y)})`,
        );
      }
    };
    const paintFocus = (e: number) => {
      for (const n of nodeEntries) {
        const o = n.from + (n.to - n.from) * e;
        n.el.style.opacity = String(o);
        store.nodes.set(n.id, o);
      }
      for (const n of edgeEntries) {
        const o = n.from.o + (n.to.o - n.from.o) * e;
        const w = n.from.w + (n.to.w - n.from.w) * e;
        n.el.style.opacity = String(o);
        n.el.setAttribute("stroke-width", String(w));
        store.edges.set(n.key, { o, w });
      }
    };
    const settle = () => {
      setRest({ step, camera: target });
      setSettled(true);
      setShown(true);
    };
    const from = camera.current;
    const cameraNear =
      from &&
      Math.abs(from.cx - target.cx) < 0.5 &&
      Math.abs(from.cy - target.cy) < 0.5 &&
      Math.abs(from.zoom / target.zoom - 1) < 0.01;
    const focusNear =
      nodeEntries.every((n) => Math.abs(n.from - n.to) < 0.02) &&
      edgeEntries.every(
        (n) => Math.abs(n.from.o - n.to.o) < 0.01 && Math.abs(n.from.w - n.to.w) < 0.01,
      );
    if (!from || reduced || (cameraNear && focusNear)) {
      paintCamera(target);
      paintFocus(1);
      settle();
      return;
    }
    setSettled(false);
    const started = performance.now() + LABEL_LEAD_MS;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - started) / MOVE_MS));
      const e = ease(t);
      paintCamera({
        zoom: from.zoom * (target.zoom / from.zoom) ** e,
        cx: from.cx + (target.cx - from.cx) * e,
        cy: from.cy + (target.cy - from.cy) * e,
      });
      paintFocus(e);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else settle();
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, step, reduced, width, height, lit, members, degrees, unit, logos, world]);

  // Render is independent of the camera and of which section is lit: elements keep
  // their keys and their DOM nodes for the whole life of a snapshot.
  const edgeEls = useMemo(() => {
    return edges.map((edge) => {
      const a = world.get(edge.source);
      const b = world.get(edge.target);
      if (!a || !b) return null;
      const hub = Math.sqrt(Math.max(degrees.get(edge.source) ?? 1, degrees.get(edge.target) ?? 1));
      const key = `${edge.source}|${edge.target}`;
      const now = focus.current.edges.get(key);
      return (
        <line
          key={key}
          data-eid=""
          data-a={edge.source}
          data-b={edge.target}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={palette.edge}
          strokeWidth={now?.w ?? 0.7 * unit}
          vectorEffect="non-scaling-stroke"
          style={{ opacity: now?.o ?? 0.34 / (1 + hub * 0.25) }}
        />
      );
    });
  }, [edges, world, unit, degrees]);

  const nodeEls = useMemo(() => {
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
        const opacity = focus.current.nodes.get(node.id) ?? 0.92;
        if (node.kind === "company") {
          const logo = logos.get(`${dark}|${node.id}`);
          const wanted = logoCandidates(node, dark).length > 0;
          // Still probing: draw nothing yet rather than flashing the fallback.
          if (wanted && logo === undefined) return null;
          return (
            <g
              key={node.id}
              data-nid={node.id}
              data-company=""
              data-x={p.x}
              data-y={p.y}
              style={{ opacity }}
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
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={palette.neutral}
                    stroke={palette.neutralRing}
                    strokeWidth={r * 0.14}
                  />
                  <text
                    x={p.x}
                    y={p.y}
                    dy="0.35em"
                    textAnchor="middle"
                    fontSize={r * 1.05}
                    fontWeight={700}
                    fontFamily="inherit"
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
          <g key={node.id} data-nid={node.id} style={{ opacity }}>
            <circle cx={p.x} cy={p.y} r={r} fill={palette.person} />
          </g>
        );
      });
  }, [nodes, world, logos, unit]);

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
    // Every node of the view is an obstacle; only the section's top people by degree
    // (`people` is sorted most-connected first) are named, so no wall of text.
    const named = new Set(
      (shownSection?.people ?? []).filter((id) => byId.get(id)?.label?.trim()).slice(0, TOP_LABELS),
    );
    for (const node of nodes) {
      const at = project(node.id);
      if (!at) continue;
      const r = apparentRadius(node.degree, node.kind, unit, cam.zoom);
      obstacles.push({ id: node.id, x: at.x, y: at.y, r });
      if (!named.has(node.id)) continue;
      candidates.push({
        id: node.id,
        text: node.label.trim(),
        x: at.x,
        y: at.y,
        r,
        priority: node.degree,
      });
    }
    const fontSize = Math.max(14, 17 * unit);
    return {
      labels: selectLabels(candidates, width, height, fontSize, TOP_LABELS, obstacles),
      fontSize,
    };
  }, [rest, shownSection, world, width, height, nodes, unit]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className="relative size-full min-h-0 min-w-0 overflow-hidden"
      style={{ background: palette.canvas }}
      data-testid="connections-graph"
    >
      {width > 0 && height > 0 && (
        <svg
          width={width}
          height={height}
          aria-hidden="true"
          className="absolute inset-0"
          style={{ opacity: shown ? 1 : 0, transition: reduced ? undefined : "opacity 600ms" }}
        >
          <g ref={worldRef}>
            <g>{edgeEls}</g>
            <g>{nodeEls}</g>
          </g>
          <g
            style={{ opacity: settled ? 1 : 0, transition: reduced ? undefined : "opacity 400ms" }}
            fontFamily="inherit"
            fontSize={placed.fontSize}
            fontWeight={500}
            fill={palette.foreground}
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
