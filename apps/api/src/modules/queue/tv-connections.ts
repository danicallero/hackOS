import { createHmac } from "node:crypto";
import type {
  TvConnectionEdge,
  TvConnectionNode,
  TvConnectionsResponse,
} from "@hackos/shared/tv-connections";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { ENTERPRISE_HAS_SYNTHETIC } from "../sponsors/service.js";

/**
 * Public TV connections graph (#934, #935). Read-only projection of the
 * event diary: nothing from notes, stars, timestamps or user ids leaves here.
 * Cached 15 s (shared cache), which is also the staleness bound for sharing changes,
 * removals and edition switches. docs/tv-screens.md § "Connections graph API".
 */

/** Payload bounds, chosen from the 600-person dense benchmark in test/queue/tv-connections.test.ts. */
export const TV_GRAPH_MAX_NODES = 2000;
export const TV_GRAPH_MAX_EDGES = 30_000;

/** Node ids rotate with the period, so snapshots from different hours cannot be joined. */
export const TV_GRAPH_ID_PERIOD_MS = 60 * 60 * 1000;

type Kind = "person" | "company";

/** Opaque id: HMAC of kind + internal id under a key derived per period from the server secret. */
function nodeIdFactory(now: number): (kind: Kind, id: number) => string {
  const period = Math.floor(now / TV_GRAPH_ID_PERIOD_MS);
  const key = createHmac("sha256", config.BETTER_AUTH_SECRET)
    .update(`tv-graph:v1:${period}`)
    .digest();
  return (kind, id) =>
    createHmac("sha256", key).update(`${kind}:${id}`).digest("base64url").slice(0, 22);
}

interface GraphRow {
  row_type: "n" | "e";
  a_kind: "p" | "c";
  a_id: number;
  b_kind: "p" | "c" | null;
  b_id: number | null;
  label: string | null;
  degree: number | null;
}

/**
 * One aggregate query. Eligible people: event access (active, not removed or
 * anonymized, current edition), not a test account, networking profile shared
 * (directory_visible); no profile row or sharing off means absent, with no
 * node and no edge. A person pair is one edge while either side keeps the
 * entry; a company edge needs a visible person and a visible, non-synthetic
 * current-edition company. The label is the display name with the surname rule.
 */
const GRAPH_SQL = `
WITH people AS (
  SELECT u.id,
         btrim(
           u.name || CASE
             WHEN NULLIF(btrim(u.surname), '') IS NULL THEN ''
             WHEN p.show_surname THEN ' ' || btrim(u.surname)
             ELSE ' ' || left(btrim(u.surname), 1) || '.'
           END) AS label
    FROM users u
    JOIN user_public_profiles p ON p.user_id = u.id AND p.directory_visible
   WHERE u.is_test_account = false
     AND u.id IN (SELECT user_id FROM user_event_access)
), companies AS (
  SELECT e.id, e.name AS label
    FROM enterprises e
   WHERE e.event_key = current_edition() AND e.visibility = 'visible'
     AND NOT ${ENTERPRISE_HAS_SYNTHETIC}
), edges AS (
  SELECT DISTINCT 'p'::text AS ak, LEAST(d.owner_id, d.target_user_id) AS a,
         'p'::text AS bk, GREATEST(d.owner_id, d.target_user_id) AS b
    FROM diary_entries d
   WHERE d.event_key = current_edition() AND d.target_user_id IS NOT NULL
     AND d.owner_id IN (SELECT id FROM people)
     AND d.target_user_id IN (SELECT id FROM people)
  UNION
  SELECT 'p', d.owner_id, 'c', d.enterprise_id
    FROM diary_entries d
   WHERE d.event_key = current_edition() AND d.enterprise_id IS NOT NULL
     AND d.owner_id IN (SELECT id FROM people)
     AND d.enterprise_id IN (SELECT id FROM companies)
), ends AS (
  SELECT ak AS k, a AS id FROM edges UNION ALL SELECT bk, b FROM edges
), deg AS (
  SELECT k, id, count(*)::int AS degree FROM ends GROUP BY k, id
)
SELECT 'n' AS row_type, deg.k AS a_kind, deg.id AS a_id, NULL::text AS b_kind, NULL::int AS b_id,
       CASE deg.k WHEN 'p' THEN pe.label ELSE co.label END AS label, deg.degree
  FROM deg
  LEFT JOIN people pe ON deg.k = 'p' AND pe.id = deg.id
  LEFT JOIN companies co ON deg.k = 'c' AND co.id = deg.id
UNION ALL
SELECT 'e', ak, a, bk, b, NULL, NULL FROM edges`;

interface RawEdge {
  a: string;
  b: string;
}

/** Builds the bounded public snapshot from raw rows; exported for unit tests of the bound. */
export function buildGraph(
  rows: GraphRow[],
  now: number,
  limits = { nodes: TV_GRAPH_MAX_NODES, edges: TV_GRAPH_MAX_EDGES },
): TvConnectionsResponse {
  const idOf = nodeIdFactory(now);
  const key = (kind: "p" | "c", id: number) => `${kind}${id}`;
  const nodes = new Map<string, { kind: Kind; internal: number; label: string; degree: number }>();
  const edges: RawEdge[] = [];
  for (const row of rows) {
    if (row.row_type === "n") {
      nodes.set(key(row.a_kind, Number(row.a_id)), {
        kind: row.a_kind === "p" ? "person" : "company",
        internal: Number(row.a_id),
        label: row.label ?? "",
        degree: Number(row.degree),
      });
    } else {
      edges.push({
        a: key(row.a_kind, Number(row.a_id)),
        b: key(row.b_kind ?? "p", Number(row.b_id)),
      });
    }
  }
  const totals = {
    people: [...nodes.values()].filter((n) => n.kind === "person").length,
    companies: [...nodes.values()].filter((n) => n.kind === "company").length,
    connections: edges.length,
  };

  // Deterministic order: highest degree first, then kind and internal id.
  const rank = (a: string, b: string) => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (!na || !nb) return 0;
    return (
      nb.degree - na.degree ||
      (na.kind === nb.kind ? 0 : na.kind === "person" ? -1 : 1) ||
      na.internal - nb.internal
    );
  };
  let keptKeys = [...nodes.keys()].sort(rank);
  let truncated = false;
  if (keptKeys.length > limits.nodes) {
    truncated = true;
    keptKeys = keptKeys.slice(0, limits.nodes);
  }
  const kept = new Set(keptKeys);
  let keptEdges = edges.filter((e) => kept.has(e.a) && kept.has(e.b));
  if (keptEdges.length < edges.length) truncated = true;
  if (keptEdges.length > limits.edges) {
    truncated = true;
    const score = (e: RawEdge) =>
      Math.min(nodes.get(e.a)?.degree ?? 0, nodes.get(e.b)?.degree ?? 0);
    keptEdges = keptEdges
      .sort(
        (x, y) =>
          score(y) - score(x) ||
          (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) ||
          (x.b < y.b ? -1 : x.b > y.b ? 1 : 0),
      )
      .slice(0, limits.edges);
  }
  // Never emit a node without an edge in the payload.
  const used = new Set<string>();
  for (const e of keptEdges) {
    used.add(e.a);
    used.add(e.b);
  }
  const outNodes: TvConnectionNode[] = keptKeys
    .filter((k) => used.has(k))
    .map((k) => {
      const n = nodes.get(k)!;
      return { id: idOf(n.kind, n.internal), kind: n.kind, label: n.label, degree: n.degree };
    });
  const outEdges: TvConnectionEdge[] = keptEdges.map((e) => {
    const a = nodes.get(e.a)!;
    const b = nodes.get(e.b)!;
    return { source: idOf(a.kind, a.internal), target: idOf(b.kind, b.internal) };
  });
  return { nodes: outNodes, edges: outEdges, truncated, totals };
}

export async function tvConnections(): Promise<TvConnectionsResponse> {
  const { rows } = await pool.query<GraphRow>(GRAPH_SQL);
  return buildGraph(rows, Date.now());
}
