import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";

/**
 * Pure layout and focus logic for the TV connections graph (#934, #935).
 * Deterministic on purpose: the same snapshot always lays out the same way,
 * and a refreshed snapshot starts from the previous positions (by node id), so
 * a wall that polls every few seconds never makes the graph jump.
 */

export interface Point {
  x: number;
  y: number;
}
export type Positions = Map<string, Point>;

const MARGIN = 0.04;
/** Work budget for the O(n²) repulsion pass, in pair evaluations. */
const PAIR_BUDGET = 4e7;

/** FNV-1a → [0, 1). Seeds placement from the node id, never from Math.random. */
export function hashUnit(text: string, salt = 0): number {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}

const clamp = (value: number) => Math.min(1 - MARGIN, Math.max(MARGIN, value));

function seedPoint(id: string, anchor: Point | null): Point {
  const angle = hashUnit(id, 1) * Math.PI * 2;
  if (anchor) {
    // Near the neighbours it connects to, so it joins the cluster in place.
    const radius = 0.015 + hashUnit(id, 2) * 0.02;
    return {
      x: clamp(anchor.x + Math.cos(angle) * radius),
      y: clamp(anchor.y + Math.sin(angle) * radius),
    };
  }
  const radius = Math.sqrt(hashUnit(id, 2)) * 0.4;
  return { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius };
}

/**
 * Positions around the unit square (soft bounds -0.6..1.6) for every node. `previous` positions are kept
 * as the starting point (and only gently relaxed), new nodes are seeded next to
 * their already placed neighbours, then a bounded force simulation settles and
 * stops — there is no running simulation afterwards.
 */
export function layoutGraph(
  nodes: TvConnectionNode[],
  edges: TvConnectionEdge[],
  previous?: Positions,
): Positions {
  const ids = nodes.map((node) => node.id).sort();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const result: Positions = new Map();
  if (n === 0) return result;

  const links: Array<[number, number]> = [];
  const neighbours: number[][] = ids.map(() => []);
  const seen = new Set<string>();
  for (const edge of edges) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push([a, b]);
    neighbours[a].push(b);
    neighbours[b].push(a);
  }

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const placed = new Uint8Array(n);
  const isKept = new Uint8Array(n);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const old = previous?.get(ids[i]);
    if (old) {
      x[i] = old.x;
      y[i] = old.y;
      placed[i] = 1;
      isKept[i] = 1;
      kept++;
    }
  }
  // Three passes let chains of new nodes anchor on each other.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      if (placed[i] && (isKept[i] || pass < 2)) continue;
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (const j of neighbours[i]) {
        if (!placed[j]) continue;
        sx += x[j];
        sy += y[j];
        count++;
      }
      if (count === 0 && pass < 2) continue;
      const point = seedPoint(ids[i], count ? { x: sx / count, y: sy / count } : null);
      x[i] = point.x;
      y[i] = point.y;
      placed[i] = 1;
    }
  }

  // A mostly known graph only relaxes a little; a fresh one settles fully.
  const mostlyKnown = kept / n > 0.8;
  const maxIterations = mostlyKnown ? 40 : 220;
  const iterations = Math.max(25, Math.min(maxIterations, Math.floor(PAIR_BUDGET / (n * n))));
  // Heavier nodes push harder: weight follows the drawn radius, so logos (the biggest
  // nodes) repel clearly more than people and keep breathing room; `gap[i]` is the
  // node's collision radius in unit-square coordinates (≈ 1000 px wide world).
  const weight = new Float64Array(n);
  const gap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const node = byId.get(ids[i]);
    const r = node ? nodeRadius(node.degree, node.kind, 1) : 3;
    weight[i] = r / 4;
    gap[i] = (r / 1000) * 1.5;
  }
  const rest = 0.6 / Math.sqrt(n);
  const repulsion = 0.25 / n;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  let alpha = mostlyKnown ? 0.12 : 1;
  const cooling = (0.01 / alpha) ** (1 / iterations);

  for (let step = 0; step < iterations; step++) {
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[i] - x[j];
        let dy = y[i] - y[j];
        let d2 = dx * dx + dy * dy;
        if (d2 > 0.16) continue; // beyond ~0.4 the push is negligible
        if (d2 < 1e-8) {
          dx = hashUnit(ids[i], 3 + step) - 0.5;
          dy = hashUnit(ids[j], 4 + step) - 0.5;
          d2 = dx * dx + dy * dy + 1e-8;
        }
        const w = Math.sqrt(weight[i] * weight[j]);
        let f = (repulsion * w) / d2;
        // Never let two nodes sit inside each other's collision radius.
        const min = gap[i] + gap[j];
        if (d2 < min * min) f += (repulsion * 4 * w) / d2;
        fx[i] += dx * f;
        fy[i] += dy * f;
        fx[j] -= dx * f;
        fy[j] -= dy * f;
      }
    }
    for (const [a, b] of links) {
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const f = ((dist - rest) / dist) * 0.5;
      fx[a] += dx * f;
      fy[a] += dy * f;
      fx[b] -= dx * f;
      fy[b] -= dy * f;
    }
    for (let i = 0; i < n; i++) {
      fx[i] += (0.5 - x[i]) * 0.08;
      fy[i] += (0.5 - y[i]) * 0.08;
      const mag = Math.hypot(fx[i], fy[i]);
      const cap = 0.03 * alpha;
      const scale = mag > cap ? cap / mag : 1;
      // Soft walls only: a hard clamp at the unit square piled nodes into straight
      // columns; the view rescales to the settled bounds anyway.
      x[i] = Math.max(-0.6, Math.min(1.6, x[i] + fx[i] * scale * alpha));
      y[i] = Math.max(-0.6, Math.min(1.6, y[i] + fy[i] * scale * alpha));
    }
    alpha *= cooling;
  }

  for (let i = 0; i < n; i++) result.set(ids[i], { x: x[i], y: y[i] });
  return result;
}

const byDegree = (a: TvConnectionNode, b: TvConnectionNode) =>
  b.degree - a.degree || (a.id < b.id ? -1 : 1);

export interface Section {
  /** People in the section, most connected first. */
  people: string[];
  /** Companies whose people are mostly in this section; they anchor the camera. */
  companies: string[];
}

const MIN_SECTION_PEOPLE = 3;
const MAX_SECTIONS = 12;

/**
 * Deterministic label propagation over the people, with companies as fixed
 * anchors (they vote with half weight but never change). Same snapshot, same
 * sections; ids are hashed for the visit order, never Math.random. Sections are
 * ordered by size so the camera starts with the biggest group. Graphs too
 * small to split return no sections and the wall just shows the overview.
 */
export function detectSections(nodes: TvConnectionNode[], edges: TvConnectionEdge[]): Section[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const people = nodes.filter((node) => node.kind === "person");
  if (people.length < MIN_SECTION_PEOPLE * 2) return [];
  const adjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  const label = new Map(nodes.map((node) => [node.id, node.id]));
  const order = people.map((node) => node.id).sort((a, b) => hashUnit(a, 7) - hashUnit(b, 7));
  for (let round = 0; round < 15; round++) {
    let changed = false;
    for (const id of order) {
      const votes = new Map<string, number>();
      for (const other of adjacency.get(id) ?? []) {
        const weight = byId.get(other)?.kind === "company" ? 0.5 : 1;
        const vote = label.get(other) as string;
        votes.set(vote, (votes.get(vote) ?? 0) + weight);
      }
      const current = label.get(id) as string;
      let best = current;
      let bestWeight = votes.get(current) ?? 0;
      for (const [vote, weight] of votes) {
        if (weight > bestWeight || (weight === bestWeight && vote < best && vote !== current)) {
          best = vote;
          bestWeight = weight;
        }
      }
      if (best !== current) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const groups = new Map<string, TvConnectionNode[]>();
  for (const person of people) {
    const key = label.get(person.id) as string;
    groups.set(key, [...(groups.get(key) ?? []), person]);
  }
  const kept = [...groups.entries()]
    .filter(([, members]) => members.length >= MIN_SECTION_PEOPLE)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_SECTIONS);
  const home = new Map<string, number>();
  for (const company of nodes.filter((node) => node.kind === "company")) {
    const tally = new Map<number, number>();
    for (const other of adjacency.get(company.id) ?? []) {
      const index = kept.findIndex(([, members]) => members.some((m) => m.id === other));
      if (index >= 0) tally.set(index, (tally.get(index) ?? 0) + 1);
    }
    let best = -1;
    let count = 0;
    for (const [index, n] of [...tally].sort((a, b) => a[0] - b[0]))
      if (n > count) {
        best = index;
        count = n;
      }
    if (best >= 0) home.set(company.id, best);
  }
  return kept.map(([, members], index) => {
    const companies = nodes
      .filter((node) => home.get(node.id) === index)
      .sort(byDegree)
      .map((node) => node.id);
    const sorted = [...members].sort(byDegree);
    return { people: sorted.map((n) => n.id), companies };
  });
}

/** Camera steps: -1 is the whole-network overview, n is section n. The overview
 * opens the loop and returns after every `every` sections. */
export function buildSequence(sectionCount: number, every = 3): number[] {
  const steps: number[] = [-1];
  for (let i = 0; i < sectionCount; i++) {
    steps.push(i);
    if ((i + 1) % every === 0 && i + 1 < sectionCount) steps.push(-1);
  }
  return sectionCount === 0 ? steps : [...steps, -1];
}

export interface Camera {
  zoom: number;
  cx: number;
  cy: number;
}

/** Camera centred on a section's people and home companies; overview is the full frame. */
export function cameraFor(
  section: Section | null,
  world: Map<string, Point>,
  width: number,
  height: number,
): Camera {
  const overview = { zoom: 1, cx: width / 2, cy: height / 2 };
  if (!section) return overview;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const id of [...section.people, ...section.companies]) {
    const point = world.get(id);
    if (!point) continue;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return overview;
  const span = Math.min(width, height) * 0.2;
  const zoom = Math.min(
    5,
    Math.max(
      1.3,
      Math.min(
        (width * 0.78) / Math.max(maxX - minX, span),
        (height * 0.7) / Math.max(maxY - minY, span),
      ),
    ),
  );
  return { zoom, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 + (height * 0.03) / zoom };
}

export interface LabelCandidate {
  id: string;
  text: string;
  /** Screen position and on-screen radius of the node at rest. */
  x: number;
  y: number;
  r: number;
  priority: number;
}
export interface PlacedLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
}
/** A node that labels must not cover (screen space, square half-size or radius). */
export interface Obstacle {
  id: string;
  x: number;
  y: number;
  r: number;
}

/**
 * Greedy, collision-free label placement in screen space: highest priority
 * first; tries right, left, above and below the node (always adjacent, offset
 * from its on-screen radius) and takes the first box that stays in the frame
 * and overlaps neither a placed label nor any other node (company squares
 * included). Capped.
 */
export function selectLabels(
  candidates: LabelCandidate[],
  width: number,
  height: number,
  fontSize: number,
  max: number,
  obstacles: Obstacle[] = [],
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const boxes: Array<[number, number, number, number]> = [];
  const margin = fontSize * 0.5;
  const sorted = [...candidates]
    .filter((c) => c.text.trim())
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const hits = (a: number[], b: number[]) =>
    a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  for (const c of sorted) {
    if (placed.length >= max) break;
    if (c.x < 0 || c.x > width || c.y < 0 || c.y > height) continue;
    const textWidth = c.text.length * fontSize * 0.58;
    const half = fontSize * 0.7;
    const gap = c.r + fontSize * 0.3;
    const options: Array<{ anchor: PlacedLabel["anchor"]; x: number; y: number; left: number }> = [
      { anchor: "start", x: c.x + gap, y: c.y, left: c.x + gap },
      { anchor: "end", x: c.x - gap, y: c.y, left: c.x - gap - textWidth },
      { anchor: "middle", x: c.x, y: c.y - c.r - half, left: c.x - textWidth / 2 },
      { anchor: "middle", x: c.x, y: c.y + c.r + half, left: c.x - textWidth / 2 },
    ];
    for (const option of options) {
      const box = [option.left - 4, option.y - half, option.left + textWidth + 4, option.y + half];
      if (box[0] < margin || box[2] > width - margin || box[1] < margin || box[3] > height - margin)
        continue;
      if (boxes.some((o) => hits(box, o))) continue;
      if (
        obstacles.some(
          (o) => o.id !== c.id && hits(box, [o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r]),
        )
      )
        continue;
      boxes.push(box as [number, number, number, number]);
      placed.push({ id: c.id, text: c.text, x: option.x, y: option.y, anchor: option.anchor });
      break;
    }
  }
  return placed;
}

/** Largest person radius (units); every company is bigger than this. */
const PERSON_MAX = 36;

/**
 * Node radius in px at overview zoom. People grow with the square root of their
 * degree, from a tiny leaf (2.4) to a capped hub (36), so hubs read as landmarks;
 * companies render their logo and always start above the biggest person.
 */
export function nodeRadius(degree: number, kind: "person" | "company", unit: number): number {
  const d = Math.sqrt(Math.max(1, degree));
  if (kind === "company") return unit * Math.min(60, PERSON_MAX + 4 + d * 1.5);
  return unit * Math.min(PERSON_MAX, 2.4 + (d - 1) * 3.6);
}

/** On-screen radius at a camera zoom: people scale with it, company squares only
 * with its square root so a zoomed section is never hidden behind them. */
export function apparentRadius(
  degree: number,
  kind: "person" | "company",
  unit: number,
  zoom: number,
): number {
  const r = nodeRadius(degree, kind, unit);
  return kind === "company" ? r * Math.sqrt(zoom) : r * zoom;
}
