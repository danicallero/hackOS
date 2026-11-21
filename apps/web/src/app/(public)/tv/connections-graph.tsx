"use client";

import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useElementSize } from "@/hooks/use-element-size";
import {
  apparentRadius,
  buildSequence,
  type Camera,
  cameraFor,
  createCoalescer,
  detectSections,
  diffSnapshots,
  edgeKey,
  type LabelCandidate,
  layoutGraph,
  linkAlpha,
  nodeRadius,
  type Obstacle,
  type Positions,
  type Section,
  type Snapshot,
  selectLabels,
  snapshotSignature,
  spawnPoint,
} from "./connections-layout";

/** Camera timing: a calm overview, then one section at a time. */
export const OVERVIEW_DWELL_MS = 6_000;
export const SECTION_DWELL_MS = 10_000;
export const MOVE_MS = 1_600;
/** Only this many of a section's most-connected people are named; the overview names nobody. */
export const TOP_LABELS = 9;
/** Labels fade out this long before the camera starts to move. */
export const LABEL_LEAD_MS = 300;
/** A data update with the camera at rest: new nodes grow in, removed ones fade, kept ones glide. */
export const DATA_MS = 1_000;

/**
 * org-roam-ui look, always dark: the wall graph draws its own flat canvas whatever
 * the OS or app theme, so logos use their negative variant and nothing needs a
 * light twin. One quiet node color, no glow, no gradient.
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

interface NodeState {
  x: number;
  y: number;
  o: number;
  s: number;
  /** 0 = in focus, 1 = out of focus: drawn small (constant on-screen size) and faint. */
  d: number;
}
/** Scale of a node's group: logos grow with sqrt(zoom), dimmed nodes keep their screen size. */
export function nodeScale(st: NodeState, company: boolean, zoom: number): number {
  const base = company ? zoom ** -0.5 : zoom ** -0.3;
  return st.s * (base + ((company ? 0.4 : 1) / zoom - base) * st.d);
}
const DIM_ALPHA = 0.07;
interface EdgeState {
  o: number;
  w: number;
}
const NO_GHOSTS = { nodes: [] as TvConnectionNode[], edges: [] as TvConnectionEdge[] };

export function ConnectionsGraph({
  nodes: inNodes,
  edges: inEdges,
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
  // Live state of every node (position, opacity, scale) and edge (opacity, width). The
  // one rAF loop animates it straight on the DOM nodes (no React render per frame);
  // React only reads it as the initial attributes of an element it (re)renders, so a
  // re-render never resets a fade or a move.
  const scene = useRef({
    nodes: new Map<string, NodeState>(),
    edges: new Map<string, EdgeState>(),
  });
  const palette: Palette = PALETTE;
  const [cursor, setCursor] = useState(0);
  // The camera the labels were laid out for; they show only while the real camera is there.
  const [rest, setRest] = useState<{ step: number; camera: Camera } | null>(null);
  const [settled, setSettled] = useState(false);
  // Nothing is painted until the first camera is in place.
  const [shown, setShown] = useState(false);

  // A poll hands over fresh arrays every time; only a change of content is an update.
  const signature = useMemo(() => snapshotSignature(inNodes, inEdges), [inNodes, inEdges]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity follows content
  const incoming = useMemo<Snapshot>(() => ({ nodes: inNodes, edges: inEdges }), [signature]);
  const [committed, setCommitted] = useState<Snapshot>(incoming);
  // Updates that land mid-transition are coalesced and applied when it ends.
  const queue = useRef(createCoalescer<Snapshot>());
  const animating = useRef(false);
  useEffect(() => {
    const next = queue.current.offer(incoming, animating.current);
    if (next) setCommitted(next);
  }, [incoming]);
  const { nodes, edges } = committed;

  // Settled once per snapshot; the previous snapshot's positions seed the next.
  const positions = useMemo(() => {
    const next = layoutGraph(nodes, edges, previous.current);
    previous.current = next;
    return next;
  }, [nodes, edges]);
  const sections = useMemo(() => detectSections(nodes, edges), [nodes, edges]);
  const sequence = useMemo(() => buildSequence(sections.length), [sections.length]);
  // The tour is a cursor into the sequence: when a data change removes the section
  // being shown, the same slot now resolves to whatever section sits there, and the
  // camera simply eases to it from where it is.
  const step = sequence[cursor % sequence.length] ?? -1;
  const section: Section | null = sections[step] ?? null;
  const shownSection: Section | null = rest ? (sections[rest.step] ?? null) : null;

  const unit = Math.max(0.5, Math.min(width, height) / 1000);
  // Rescale the settled layout to its own bounds, padded by the biggest logo, so the
  // first frame is centered and nothing is clipped whatever shape the force pass took.
  const world = useMemo(() => {
    // ~6% margin, never less than a logo's radius, so nothing is clipped.
    const logo = nodeRadius(0, "company", unit) * 1.1;
    const padX = Math.min(Math.max(logo, width * 0.06), width * 0.2);
    const padY = Math.min(Math.max(logo, height * 0.06), height * 0.2);
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
        x: padX + ((p.x - minX) / spanX) * (width - padX * 2),
        y: padY + ((p.y - minY) / spanY) * (height - padY * 2),
      });
    return map;
  }, [positions, width, height, unit]);

  // Advance the sequence; a hidden tab holds still and resumes where it was.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `cursor` re-arms the timer when the loop wraps from one overview onto the next (same `step`)
  useEffect(() => {
    if (!visible || sequence.length < 2) return;
    const dwell = step === -1 ? OVERVIEW_DWELL_MS : SECTION_DWELL_MS;
    const timer = window.setTimeout(() => setCursor((c) => c + 1), dwell + MOVE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, sequence.length, cursor, step]);

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
  // Links fade by their most connected *person*: hub bundles stay faint.
  const personDegree = useCallback(
    (a: string, b: string) =>
      Math.max(
        kinds.get(a) === "person" ? (degrees.get(a) ?? 1) : 1,
        kinds.get(b) === "person" ? (degrees.get(b) ?? 1) : 1,
      ),
    [kinds, degrees],
  );

  // Degree of the company at either end of a link, undefined for person-person links.
  const companyDegree = useCallback(
    (a: string, b: string) =>
      kinds.get(a) === "company"
        ? (degrees.get(a) ?? 1)
        : kinds.get(b) === "company"
          ? (degrees.get(b) ?? 1)
          : undefined,
    [kinds, degrees],
  );

  // New nodes start (invisible, small) on their neighbors; the very first snapshot
  // starts in place. Only ids the scene does not know yet are touched, so this is
  // idempotent (StrictMode, re-renders).
  useMemo(() => {
    const sc = scene.current;
    // Before the box is measured every world position is the origin: seeding then would
    // park every node (logos first, as they mount late) in the top-left corner.
    if (width === 0 || height === 0) return;
    const first = sc.nodes.size === 0 && !camera.current;
    // An update that replaces (almost) every id, e.g. the hourly id rotation, is a
    // crossfade in place: new nodes appear at their final spot, never growing or flying.
    const known = nodes.filter((n) => sc.nodes.has(n.id)).length;
    const replaced = !first && known < nodes.length * 0.3;
    for (const node of nodes) {
      if (sc.nodes.has(node.id)) continue;
      const p = world.get(node.id);
      if (!p) continue;
      if (first) {
        sc.nodes.set(node.id, { x: p.x, y: p.y, o: 0.92, s: 1, d: 0 });
        continue;
      }
      const at = replaced
        ? p
        : spawnPoint(
            p,
            (adjacency.get(node.id) ?? [])
              .map((id) => sc.nodes.get(id))
              .filter((n): n is NodeState => Boolean(n)),
          );
      sc.nodes.set(node.id, { x: at.x, y: at.y, o: 0, s: replaced ? 1 : 0.3, d: 0 });
    }
    if (!first)
      for (const edge of edges)
        if (!sc.edges.has(edgeKey(edge))) sc.edges.set(edgeKey(edge), { o: 0, w: 0.7 * unit });
  }, [nodes, edges, world, adjacency, unit, width, height]);

  // Removed nodes and edges stay mounted (as "ghosts") while they fade out, then drop.
  const history = useRef<{ cur: Snapshot; prev: Snapshot | null }>({
    cur: committed,
    prev: null,
  });
  const ghostSet = useMemo(() => {
    if (history.current.cur !== committed)
      history.current = { cur: committed, prev: history.current.cur };
    const prev = history.current.prev;
    if (!prev) return NO_GHOSTS;
    const diff = diffSnapshots(prev, committed);
    const gone = new Set(diff.removedNodes);
    const goneEdges = new Set(diff.removedEdges);
    return {
      nodes: prev.nodes.filter((n) => gone.has(n.id)),
      edges: prev.edges.filter((e) => goneEdges.has(edgeKey(e))),
    };
  }, [committed]);
  const [dropped, setDropped] = useState<Snapshot | null>(null);
  const ghosts = dropped === committed ? NO_GHOSTS : ghostSet;

  // Own camera: ONE rAF loop that writes the world transform and every node's
  // position, scale and opacity and every edge's opacity and width straight onto
  // stable DOM nodes. Nothing here renders React, so a transition costs the browser one
  // style/paint pass per frame, not a reconciliation of ~1500 elements. A section move,
  // a data update or a poll retargets from the live camera and scene, so nothing snaps
  // back mid-move; the rAF loop is the only writer.
  // `logos` re-keys the effect when company elements are (re)drawn, so they get the camera.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    const group = worldRef.current;
    if (!group || width === 0 || height === 0) {
      animating.current = false;
      return;
    }
    const sc = scene.current;
    interface NodeEntry {
      el: SVGElement;
      id: string;
      st: NodeState;
      from: NodeState;
      to: NodeState;
      company: boolean;
      moves: boolean;
      fades: boolean;
    }
    // Is a world point inside the frame the target camera will show (plus a margin)?
    const inFrame = (p: { x: number; y: number }, margin: number) => {
      const sx = (p.x - target.cx) * target.zoom + width / 2;
      const sy = (p.y - target.cy) * target.zoom + height / 2;
      return sx >= margin && sx <= width - margin && sy >= margin && sy <= height - margin;
    };
    const focused = new Map<string, boolean>();
    const nodeEntries: NodeEntry[] = [];
    const entryById = new Map<string, NodeEntry>();
    for (const el of group.querySelectorAll<SVGElement>("[data-nid]")) {
      const id = el.dataset.nid as string;
      const st = sc.nodes.get(id);
      if (!st) continue;
      const ghost = el.dataset.ghost !== undefined;
      const w = world.get(id);
      let to: NodeState;
      if (ghost || !w) to = { x: st.x, y: st.y, o: 0, s: 0.3, d: st.d };
      else if (!lit) to = { x: w.x, y: w.y, o: 0.92, s: 1, d: 0 };
      else {
        const company = el.dataset.company !== undefined;
        const r = nodeRadius(degrees.get(id) ?? 0, company ? "company" : "person", unit);
        const seen = inFrame(w, (company ? r * target.zoom ** 0.5 : r * target.zoom) + 3);
        if (company) {
          // A logo is shown only whole, inside the frame, and only if the section reaches it.
          if (lit.has(id) && seen) to = { x: w.x, y: w.y, o: 1, s: 1, d: 0 };
          else to = { x: w.x, y: w.y, o: seen ? DIM_ALPHA : 0, s: 1, d: 1 };
        } else if (lit.has(id) && seen) to = { x: w.x, y: w.y, o: 1, s: 1, d: 0 };
        // Out of focus, or cut by the frame edge: small and faint, or gone if it would be clipped.
        else to = { x: w.x, y: w.y, o: seen ? DIM_ALPHA : 0, s: 1, d: 1 };
      }
      focused.set(id, to.d === 0 && to.o > 0);
      const from = { ...st };
      const entry: NodeEntry = {
        el,
        id,
        st,
        from,
        to,
        company: el.dataset.company !== undefined,
        moves: from.x !== to.x || from.y !== to.y || from.s !== to.s || from.d !== to.d,
        fades: from.o !== to.o,
      };
      nodeEntries.push(entry);
      entryById.set(id, entry);
    }
    interface EdgeEntry {
      el: SVGElement;
      a: NodeState;
      b: NodeState;
      es: EdgeState;
      from: EdgeState;
      to: EdgeState;
      moves: boolean;
      /** Opacity or width changes in this transition; unchanged edges are not rewritten per frame. */
      dirty: boolean;
    }
    const edgeEntries: EdgeEntry[] = [];
    for (const el of group.querySelectorAll<SVGElement>("[data-eid]")) {
      const aId = el.dataset.a as string;
      const bId = el.dataset.b as string;
      const a = sc.nodes.get(aId);
      const b = sc.nodes.get(bId);
      if (!a || !b) continue;
      const key = `${aId}|${bId}`;
      const pd = personDegree(aId, bId);
      // Full strength only between nodes that are both in focus, in frame and shown.
      const on = lit
        ? Boolean(focused.get(aId) && focused.get(bId)) &&
          Boolean(members?.has(aId) || members?.has(bId))
        : false;
      let es = sc.edges.get(key);
      if (!es) {
        es = { o: Number(el.getAttribute("stroke-opacity")) || 0, w: (on ? 1.4 : 0.7) * unit };
        sc.edges.set(key, es);
      }
      const ghost = el.dataset.ghost !== undefined;
      const to: EdgeState = ghost
        ? { o: 0, w: es.w }
        : {
            o: linkAlpha(pd, lit ? (on ? "focus" : "dim") : "overview", companyDegree(aId, bId)),
            w: (on ? 1.4 : 0.7) * unit,
          };
      edgeEntries.push({
        el,
        a,
        b,
        es,
        from: { ...es },
        to,
        moves: Boolean(entryById.get(aId)?.moves || entryById.get(bId)?.moves),
        dirty: es.o !== to.o || es.w !== to.w,
      });
    }
    const paint = (c: Camera, e: number) => {
      camera.current = c;
      group.setAttribute(
        "transform",
        `translate(${width / 2} ${height / 2}) scale(${c.zoom}) translate(${-c.cx} ${-c.cy})`,
      );
      const zoomed = c.zoom !== 1;
      for (const n of nodeEntries) {
        if (n.moves) {
          n.st.x = n.from.x + (n.to.x - n.from.x) * e;
          n.st.y = n.from.y + (n.to.y - n.from.y) * e;
          n.st.s = n.from.s + (n.to.s - n.from.s) * e;
          n.st.d = n.from.d + (n.to.d - n.from.d) * e;
        }
        if (n.fades) {
          n.st.o = n.from.o + (n.to.o - n.from.o) * e;
          n.el.style.opacity = String(n.st.o);
        }
        if (n.moves || n.company || zoomed || n.st.d > 0)
          n.el.setAttribute(
            "transform",
            `translate(${n.st.x} ${n.st.y}) scale(${nodeScale(n.st, n.company, c.zoom)})`,
          );
      }
      for (const n of edgeEntries) {
        if (n.dirty) {
          n.es.o = n.from.o + (n.to.o - n.from.o) * e;
          n.es.w = n.from.w + (n.to.w - n.from.w) * e;
          // stroke-opacity, not opacity: a group opacity per line forces an offscreen layer each.
          n.el.setAttribute("stroke-opacity", String(n.es.o));
          n.el.setAttribute("stroke-width", String(n.es.w));
        }
        if (n.moves) {
          n.el.setAttribute("x1", String(n.a.x));
          n.el.setAttribute("y1", String(n.a.y));
          n.el.setAttribute("x2", String(n.b.x));
          n.el.setAttribute("y2", String(n.b.y));
        }
      }
    };
    const settle = () => {
      animating.current = false;
      setRest({ step, camera: target });
      setSettled(true);
      setShown(true);
      setDropped(committed);
      const liveNodes = new Set(nodes.map((n) => n.id));
      for (const id of sc.nodes.keys()) if (!liveNodes.has(id)) sc.nodes.delete(id);
      const liveEdges = new Set(edges.map(edgeKey));
      for (const key of sc.edges.keys()) if (!liveEdges.has(key)) sc.edges.delete(key);
      const pending = queue.current.release();
      if (pending) setCommitted(pending);
    };
    const from = camera.current;
    const cameraNear =
      from &&
      Math.abs(from.cx - target.cx) < 0.5 &&
      Math.abs(from.cy - target.cy) < 0.5 &&
      Math.abs(from.zoom / target.zoom - 1) < 0.01;
    const sceneNear =
      nodeEntries.every(
        (n) =>
          Math.abs(n.from.x - n.to.x) < 0.5 &&
          Math.abs(n.from.y - n.to.y) < 0.5 &&
          Math.abs(n.from.o - n.to.o) < 0.02 &&
          Math.abs(n.from.s - n.to.s) < 0.01 &&
          Math.abs(n.from.d - n.to.d) < 0.02,
      ) &&
      edgeEntries.every(
        (n) => Math.abs(n.from.o - n.to.o) < 0.01 && Math.abs(n.from.w - n.to.w) < 0.01,
      );
    if (!from || reduced || (cameraNear && sceneNear)) {
      for (const n of nodeEntries) {
        n.moves = true;
        n.fades = true;
      }
      for (const n of edgeEntries) {
        n.moves = true;
        n.dirty = true;
      }
      paint(target, 1);
      settle();
      return;
    }
    animating.current = true;
    setSettled(false);
    const duration = cameraNear ? DATA_MS : MOVE_MS;
    const started = performance.now() + LABEL_LEAD_MS;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - started) / duration));
      const e = ease(t);
      paint(
        {
          zoom: from.zoom * (target.zoom / from.zoom) ** e,
          cx: from.cx + (target.cx - from.cx) * e,
          cy: from.cy + (target.cy - from.cy) * e,
        },
        e,
      );
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else settle();
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [
    target,
    step,
    reduced,
    width,
    height,
    lit,
    members,
    personDegree,
    companyDegree,
    unit,
    logos,
    world,
    committed,
  ]);

  // Render never depends on the camera or on which section is lit: elements keep their
  // keys and DOM nodes for the life of a snapshot, and read their live attributes from
  // the scene.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `world` flips from unmeasured to measured after mount, and edges must redraw then
  const edgeEls = useMemo(() => {
    const sc = scene.current;
    const draw = (edge: TvConnectionEdge, ghost: boolean) => {
      const a = sc.nodes.get(edge.source);
      const b = sc.nodes.get(edge.target);
      if (!a || !b) return null;
      const key = edgeKey(edge);
      const now = sc.edges.get(key);
      return (
        <line
          key={key}
          data-eid=""
          data-ghost={ghost ? "" : undefined}
          data-a={edge.source}
          data-b={edge.target}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={palette.edge}
          strokeWidth={now?.w ?? 0.7 * unit}
          vectorEffect="non-scaling-stroke"
          strokeOpacity={
            now?.o ??
            linkAlpha(
              personDegree(edge.source, edge.target),
              "overview",
              companyDegree(edge.source, edge.target),
            )
          }
        />
      );
    };
    return [...edges.map((e) => draw(e, false)), ...ghosts.edges.map((e) => draw(e, true))];
  }, [edges, ghosts, unit, personDegree, companyDegree, world]);

  const nodeEls = useMemo(() => {
    const sc = scene.current;
    const zoom = camera.current?.zoom ?? 1;
    const draw = (node: TvConnectionNode, ghost: boolean) => {
      const st = sc.nodes.get(node.id);
      if (!st || (!ghost && !world.get(node.id))) return null;
      const r = nodeRadius(node.degree, node.kind, unit);
      const common = {
        "data-nid": node.id,
        "data-ghost": ghost ? "" : undefined,
        style: { opacity: st.o },
      };
      if (node.kind === "company") {
        const logo = logos.get(`${dark}|${node.id}`);
        const wanted = logoCandidates(node, dark).length > 0;
        // Still probing: draw nothing yet rather than flashing the fallback.
        if (wanted && logo === undefined && !ghost) return null;
        return (
          <g
            key={node.id}
            {...common}
            data-company=""
            transform={`translate(${st.x} ${st.y}) scale(${nodeScale(st, true, zoom)})`}
          >
            {logo ? (
              <image
                href={logo}
                x={-r}
                y={-r}
                width={r * 2}
                height={r * 2}
                preserveAspectRatio="xMidYMid meet"
              />
            ) : (
              <>
                <circle
                  r={r}
                  fill={palette.neutral}
                  stroke={palette.neutralRing}
                  strokeWidth={r * 0.14}
                />
                <text
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
        <g
          key={node.id}
          {...common}
          transform={`translate(${st.x} ${st.y}) scale(${nodeScale(st, false, zoom)})`}
        >
          <circle r={r} fill={palette.person} />
        </g>
      );
    };
    const order = (a: TvConnectionNode, b: TvConnectionNode) =>
      Number(a.kind === "company") - Number(b.kind === "company") ||
      a.degree - b.degree ||
      (a.id < b.id ? -1 : 1);
    return [
      ...[...nodes].sort(order).map((n) => draw(n, false)),
      ...[...ghosts.nodes].sort(order).map((n) => draw(n, true)),
    ];
  }, [nodes, ghosts, world, logos, unit]);

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
      (shownSection?.people ?? [])
        .filter((id) => byId.get(id)?.label?.trim())
        .slice(0, TOP_LABELS * 2),
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
