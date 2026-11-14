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

function seedPoint(id: string, anchor: Point | null, home: Point): Point {
  const angle = hashUnit(id, 1) * Math.PI * 2;
  if (anchor) {
    // Near the neighbours it connects to, so it joins the cluster in place.
    const radius = 0.015 + hashUnit(id, 2) * 0.02;
    return {
      x: clamp(anchor.x + Math.cos(angle) * radius),
      y: clamp(anchor.y + Math.sin(angle) * radius),
    };
  }
  // Fresh node: scattered around its community's anchor.
  const radius = Math.sqrt(hashUnit(id, 2)) * 0.09;
  return { x: home.x + Math.cos(angle) * radius, y: home.y + Math.sin(angle) * radius };
}

/** Ring of community anchors around the canvas centre, biggest community first. */
const RING = { rx: 0.4, ry: 0.3 };
export function communityAnchors(count: number): Point[] {
  if (count <= 1) return count === 1 ? [{ x: 0.5, y: 0.5 }] : [];
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    return { x: 0.5 + RING.rx * Math.cos(angle), y: 0.5 + RING.ry * Math.sin(angle) };
  });
}

/** Companies sit on a ring outside the community ring, never at the centre of gravity. */
const COMPANY_RING = { rx: 0.56, ry: 0.43 };
const companyCount = (flags: boolean[]) => flags.filter(Boolean).length;

/** Spread preferred ring angles so logos keep a minimum angular gap (deterministic). */
export function placeCompanyAngles(order: number[], preferred: number[]): number[] {
  const m = preferred.length;
  const TAU = Math.PI * 2;
  if (m < 2) return preferred;
  const minGap = (TAU / m) * 0.6;
  const norm = preferred.map((a) => ((a % TAU) + TAU) % TAU);
  const idx = norm.map((_, k) => k).sort((p, q) => norm[p] - norm[q] || order[p] - order[q]);
  const ang = idx.map((k) => norm[k]);
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let k = 0; k < m; k++) {
      const next = (k + 1) % m;
      const gap = (ang[next] - ang[k] + TAU) % TAU;
      if (gap < minGap) {
        const push = (minGap - gap) / 2;
        ang[k] -= push;
        ang[next] += push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const out = new Array<number>(m);
  idx.forEach((k, r) => {
    out[k] = ang[r];
  });
  return out;
}

/** Link opacity from the most connected person at either end: hub bundles stay faint. */
export function linkAlpha(
  personDegree: number,
  mode: "overview" | "focus" | "dim",
  companyDegree?: number,
): number {
  const hub = Math.sqrt(Math.max(1, personDegree));
  if (companyDegree !== undefined) {
    // A sponsor is scanned by hundreds: its spokes are a whisper in the overview (shared
    // out over its degree) and only full strength where the section is lit.
    if (mode === "dim") return 0.006;
    if (mode === "focus") return 0.4 / (1 + 0.05 * hub);
    return Math.min(0.03, 3 / Math.max(1, companyDegree));
  }
  if (mode === "dim") return 0.025;
  if (mode === "focus") return 0.85 / (1 + 0.05 * hub);
  return 0.2 / (1 + 0.2 * hub);
}

/**
 * Positions around the unit square (soft bounds -0.6..1.6) for every node. Communities
 * (`detectSections`) get anchor points on an ellipse around the centre, biggest first;
 * people gravitate to their community's anchor, companies to a point outside or
 * between the communities they link to; links inside a community are short and
 * stiff, links across communities long and weak, so groups separate. `previous` positions are kept
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
  const isCompany = ids.map((id) => byId.get(id)?.kind === "company");

  // Communities, their anchors, and each node's gravity target.
  const sections = detectSections(nodes, edges);
  const anchors = communityAnchors(sections.length);
  const centre = { x: 0.5, y: 0.5 };
  const community = new Int16Array(n).fill(-1);
  sections.forEach((section, c) => {
    for (const id of section.people) {
      const i = index.get(id);
      if (i !== undefined) community[i] = c;
    }
  });
  // People outside every section follow the majority of their person neighbours.
  for (let i = 0; i < n; i++) {
    if (isCompany[i] || community[i] >= 0) continue;
    const votes = new Map<number, number>();
    for (const j of neighbours[i])
      if (!isCompany[j] && community[j] >= 0)
        votes.set(community[j], (votes.get(community[j]) ?? 0) + 1);
    let best = -1;
    let count = 0;
    for (const [c, v] of [...votes].sort((p, q) => p[0] - q[0]))
      if (v > count) [best, count] = [c, v];
    community[i] = best;
  }
  // Companies never take part in communities: their angle on the outer ring comes from
  // where their people are (one dominant group: next to it; spread over many: an even slot).
  let slot = 0;
  const diffuse = companyCount(isCompany) || 1;
  const companyAngle = (i: number, id: string): number => {
    const tally = new Map<number, number>();
    for (const j of neighbours[i])
      if (!isCompany[j] && community[j] >= 0)
        tally.set(community[j], (tally.get(community[j]) ?? 0) + 1);
    let total = 0;
    let top = 0;
    let topCommunity = -1;
    for (const [c, v] of [...tally].sort((p, q) => p[0] - q[0])) {
      total += v;
      if (v > top) [top, topCommunity] = [v, c];
    }
    if (total === 0) return hashUnit(id, 5) * Math.PI * 2;
    if (top / total >= 0.6)
      return Math.atan2(
        (anchors[topCommunity].y - 0.5) / RING.ry,
        (anchors[topCommunity].x - 0.5) / RING.rx,
      );
    const k = slot++;
    return -Math.PI / 2 + Math.PI / Math.max(1, sections.length) + (2 * Math.PI * k) / diffuse;
  };
  const home: Point[] = ids.map(() => centre);
  for (let i = 0; i < n; i++)
    if (!isCompany[i] && community[i] >= 0) home[i] = anchors[community[i]];
  const companyIdx = ids.map((_, i) => i).filter((i) => isCompany[i]);
  const preferred = companyIdx.map((i) => companyAngle(i, ids[i]));
  placeCompanyAngles(companyIdx, preferred).forEach((angle, k) => {
    home[companyIdx[k]] = {
      x: 0.5 + COMPANY_RING.rx * Math.cos(angle),
      y: 0.5 + COMPANY_RING.ry * Math.sin(angle),
    };
  });

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
        if (isCompany[i] || !placed[j] || isCompany[j]) continue;
        sx += x[j];
        sy += y[j];
        count++;
      }
      if (count === 0 && pass < 2 && !isCompany[i]) continue; // logos seed on their ring slot
      const point = seedPoint(ids[i], count ? { x: sx / count, y: sy / count } : null, home[i]);
      x[i] = point.x;
      y[i] = point.y;
      placed[i] = 1;
    }
  }

  // A mostly known graph only relaxes a little; a fresh one settles fully.
  const mostlyKnown = kept / n > 0.8;
  const maxIterations = mostlyKnown ? 40 : 220;
  const iterations = Math.max(25, Math.min(maxIterations, Math.floor(PAIR_BUDGET / (n * n))));
  // Heavier nodes push harder: weight follows the drawn radius, so hubs and logos
  // repel more than leaves; `gap[i]` is the node's collision radius in unit-square
  // coordinates (≈ 1000 px wide world).
  const weight = new Float64Array(n);
  const gap = new Float64Array(n);
  const radius = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const node = byId.get(ids[i]);
    const r = node ? nodeRadius(node.degree, node.kind, 1) : 3;
    radius[i] = r / 1000;
    // Logos keep their clearance (final pass) but must not shove the whole graph away.
    weight[i] = node?.kind === "company" ? 8 : (r / 4) ** 1.25;
    gap[i] = (r / 1000) * 1.5;
  }
  const rest = 0.6 / Math.sqrt(n);
  const repulsion = 0.25 / n;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  let alpha = mostlyKnown ? 0.12 : 1;
  const cooling = (0.01 / alpha) ** (1 / iterations);
  // Per-link rest length and stiffness: tight inside a community, loose across.
  const linkRest = new Float64Array(links.length);
  const linkStiff = new Float64Array(links.length);
  links.forEach(([a, b], k) => {
    if (isCompany[a] || isCompany[b]) {
      // Sponsor spokes are weak: they must not collapse people onto the logo.
      linkRest[k] = rest * 3;
      linkStiff[k] = 0.004;
    } else if (community[a] >= 0 && community[a] === community[b]) {
      linkRest[k] = rest * 0.7;
      linkStiff[k] = 0.6;
    } else {
      linkRest[k] = rest * 4;
      linkStiff[k] = 0.02;
    }
  });

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
    links.forEach(([a, b], k) => {
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const f = ((dist - linkRest[k]) / dist) * linkStiff[k];
      // A logo is pulled by dozens of links: damp it so it stays where its group wants it.
      const fa = isCompany[a] ? 1 / Math.sqrt(neighbours[a].length) : 1;
      const fb = isCompany[b] ? 1 / Math.sqrt(neighbours[b].length) : 1;
      fx[a] += dx * f * fa;
      fy[a] += dy * f * fa;
      fx[b] -= dx * f * fb;
      fy[b] -= dy * f * fb;
    });
    for (let i = 0; i < n; i++) {
      const pull = isCompany[i] ? 2.5 : community[i] >= 0 ? 1.1 : 0.12;
      fx[i] += (home[i].x - x[i]) * pull;
      fy[i] += (home[i].y - y[i]) * pull;
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

  // Hard guarantee: a logo never sits under another node. Companies stay put, people
  // (and, between two logos, the later one) are pushed out to the clearance.
  const logos: number[] = [];
  for (let i = 0; i < n; i++) if (isCompany[i]) logos.push(i);
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const c of logos) {
      for (let j = 0; j < n; j++) {
        if (j === c || (isCompany[j] && j < c)) continue;
        const need = (radius[c] + radius[j]) * 1.15;
        let dx = x[j] - x[c];
        let dy = y[j] - y[c];
        let d = Math.hypot(dx, dy);
        if (d >= need) continue;
        if (d < 1e-9) {
          const angle = hashUnit(ids[j], 9) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
          x[j] += dx * need;
          y[j] += dy * need;
        } else {
          x[j] += (dx / d) * (need - d);
          y[j] += (dy / d) * (need - d);
        }
        moved = true;
      }
    }
    if (!moved) break;
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
  // Communities come from person-person links only: sponsors are linked to most people and
  // would merge every group (and drag everyone to one centre).
  const adjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  const companyLinks = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (edge.source === edge.target || !a || !b) continue;
    if (a.kind === "company" || b.kind === "company") {
      const [company, person] = a.kind === "company" ? [a, b] : [b, a];
      if (person.kind === "person") companyLinks.get(company.id)?.push(person.id);
      continue;
    }
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  const label = new Map(people.map((node) => [node.id, node.id]));
  const order = people.map((node) => node.id).sort((a, b) => hashUnit(a, 7) - hashUnit(b, 7));
  for (let round = 0; round < 15; round++) {
    let changed = false;
    for (const id of order) {
      const votes = new Map<string, number>();
      for (const other of adjacency.get(id) ?? []) {
        // Hubs link across every group; their vote is diluted so they do not merge the groups.
        const weight = 1 / Math.max(1, (adjacency.get(other)?.length ?? 1) / 10);
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
    for (const other of companyLinks.get(company.id) ?? []) {
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
  // Frame the section's own people (trimming the stragglers of big groups), then take in a
  // logo only if it already sits near that frame; a far logo is left out and hidden.
  const pts = section.people.map((id) => world.get(id)).filter((p): p is Point => Boolean(p));
  if (pts.length === 0) return overview;
  const trim = pts.length >= 12 ? Math.floor(pts.length * 0.06) : 0;
  const range = (values: number[]): [number, number] => {
    const sorted = [...values].sort((p, q) => p - q);
    return [sorted[trim], sorted[sorted.length - 1 - trim]];
  };
  let [minX, maxX] = range(pts.map((p) => p.x));
  let [minY, maxY] = range(pts.map((p) => p.y));
  const padX = (maxX - minX) * 0.2;
  const padY = (maxY - minY) * 0.2;
  for (const id of section.companies) {
    const point = world.get(id);
    if (!point) continue;
    if (
      point.x >= minX - padX &&
      point.x <= maxX + padX &&
      point.y >= minY - padY &&
      point.y <= maxY + padY
    ) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  const span = Math.min(width, height) * 0.2;
  const zoom = Math.min(
    5,
    Math.max(
      1.3,
      Math.min(
        (width * 0.8) / Math.max(maxX - minX, span),
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
/** Person radius curve: `PERSON_BASE * degree^PERSON_EXPONENT`, softly capped. */
const PERSON_BASE = 2.9;
const PERSON_EXPONENT = 0.568;
/** Asymptote of the soft cap (tanh), below PERSON_MAX so companies stay bigger. */
const PERSON_SOFT_CAP = 34;

/**
 * Person radius in units (px at 1000 px height, overview zoom). A fixed power law
 * (so 4 vs 10 connections differ clearly) run through a tanh soft cap (so 50, 80
 * and 120 stay distinct yet never exceed PERSON_SOFT_CAP). Absolute degree scale:
 * sizes do not change when the snapshot's max degree does.
 */
export function personRadius(degree: number): number {
  const raw = PERSON_BASE * Math.max(1, degree) ** PERSON_EXPONENT;
  return PERSON_SOFT_CAP * Math.tanh(raw / PERSON_SOFT_CAP);
}

/**
 * Node radius in px at overview zoom. People follow `personRadius` (power law, soft cap);
 * companies render their logo and always start above the biggest person.
 */
export function nodeRadius(degree: number, kind: "person" | "company", unit: number): number {
  const d = Math.sqrt(Math.max(1, degree));
  if (kind === "company") return unit * Math.min(60, PERSON_MAX + 4 + d * 1.5);
  return unit * personRadius(degree);
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

export interface Snapshot {
  nodes: TvConnectionNode[];
  edges: TvConnectionEdge[];
}

export const edgeKey = (e: TvConnectionEdge): string => `${e.source}|${e.target}`;

/** Order-insensitive content signature: equal signature = nothing to animate. */
export function snapshotSignature(nodes: TvConnectionNode[], edges: TvConnectionEdge[]): string {
  const n = nodes.map(
    (x) => `${x.id}:${x.kind}:${x.label}:${x.degree}:${x.logoUrl ?? ""}:${x.logoNegativeUrl ?? ""}`,
  );
  return `${n.sort().join("|")}#${edges.map(edgeKey).sort().join("|")}`;
}

export interface SnapshotDiff {
  addedNodes: string[];
  removedNodes: string[];
  keptNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  keptEdges: string[];
}

/** What a data update adds, removes and keeps, by node id and `source|target` edge key. */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): SnapshotDiff {
  const split = (before: string[], after: string[]) => {
    const was = new Set(before);
    const is = new Set(after);
    return {
      added: after.filter((k) => !was.has(k)),
      removed: before.filter((k) => !is.has(k)),
      kept: after.filter((k) => was.has(k)),
    };
  };
  const n = split(
    prev?.nodes.map((x) => x.id) ?? [],
    next.nodes.map((x) => x.id),
  );
  const e = split(prev?.edges.map(edgeKey) ?? [], next.edges.map(edgeKey));
  return {
    addedNodes: n.added,
    removedNodes: n.removed,
    keptNodes: n.kept,
    addedEdges: e.added,
    removedEdges: e.removed,
    keptEdges: e.kept,
  };
}

/**
 * Coalesces updates that arrive while a transition runs: only the newest is kept
 * and handed out when the transition ends, so a burst becomes one transition.
 */
export function createCoalescer<T>() {
  let pending: T | null = null;
  return {
    /** Returns `next` to apply now, or null if it was parked behind a running transition. */
    offer(next: T, busy: boolean): T | null {
      if (busy) {
        pending = next;
        return null;
      }
      pending = null;
      return next;
    },
    /** The parked update to apply once the transition has ended, if any. */
    release(): T | null {
      const next = pending;
      pending = null;
      return next;
    },
  };
}

/**
 * Where a new node starts: the centroid of its neighbours already on screen, or, with
 * none (or a non-finite centroid), its own laid-out position. Never an origin default.
 */
export function spawnPoint(own: Point, neighbours: Point[]): Point {
  if (neighbours.length === 0) return own;
  const x = neighbours.reduce((a, n) => a + n.x, 0) / neighbours.length;
  const y = neighbours.reduce((a, n) => a + n.y, 0) / neighbours.length;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : own;
}
