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
 * Positions in the unit square for every node. `previous` positions are kept
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
        if (d2 > 0.09) continue; // beyond ~0.3 the push is negligible
        if (d2 < 1e-8) {
          dx = hashUnit(ids[i], 3 + step) - 0.5;
          dy = hashUnit(ids[j], 4 + step) - 0.5;
          d2 = dx * dx + dy * dy + 1e-8;
        }
        const f = repulsion / d2;
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
      x[i] = clamp(x[i] + fx[i] * scale * alpha);
      y[i] = clamp(y[i] + fy[i] * scale * alpha);
    }
    alpha *= cooling;
  }

  for (let i = 0; i < n; i++) result.set(ids[i], { x: x[i], y: y[i] });
  return result;
}

/** Ids of the nodes that get a text label: every named company, then the most
 * connected named people, capped so 500+ nodes never turn into clutter. */
export function labelledNodeIds(nodes: TvConnectionNode[], maxPeople = 14, maxCompanies = 12) {
  const byDegree = (a: TvConnectionNode, b: TvConnectionNode) =>
    b.degree - a.degree || (a.id < b.id ? -1 : 1);
  const named = nodes.filter((node) => node.label?.trim());
  const companies = named.filter((node) => node.kind === "company").sort(byDegree);
  const people = named.filter((node) => node.kind === "person").sort(byDegree);
  // Hubs of one or two links are not worth a label.
  return new Set(
    [
      ...companies.slice(0, maxCompanies),
      ...people.filter((p) => p.degree >= 3).slice(0, maxPeople),
    ].map((node) => node.id),
  );
}

export interface FocusGroup {
  hub: string;
  members: Set<string>;
}

/**
 * Neighbourhoods the wall cycles through: the most connected nodes first, each
 * hub with everyone it links to, skipping hubs an earlier group already shows.
 * Only a highlight order — the graph itself is always drawn in full.
 */
export function buildFocusGroups(
  nodes: TvConnectionNode[],
  edges: TvConnectionEdge[],
  maxGroups = 10,
): FocusGroup[] {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  const order = [...nodes].sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1));
  const covered = new Set<string>();
  const groups: FocusGroup[] = [];
  for (const node of order) {
    if (groups.length >= maxGroups) break;
    const around = adjacency.get(node.id);
    if (!around || around.size === 0 || covered.has(node.id)) continue;
    const members = new Set([node.id, ...around]);
    for (const id of members) covered.add(id);
    groups.push({ hub: node.id, members });
  }
  return groups;
}

/** Node diameter in `unit`-scaled px: area follows degree, with a floor so a
 * single link is still visible from across the room. */
export function nodeSize(degree: number, kind: "person" | "company", unit: number): number {
  const base = kind === "company" ? 16 : 7;
  return unit * (base + Math.sqrt(Math.max(0, degree)) * (kind === "company" ? 3.2 : 3));
}
