/** Public TV connections graph contract shared by API and web (#934, #935). */

/** Mode name added to the TV mode enum. */
export const TV_CONNECTIONS_MODE = "connections" as const;

export type TvConnectionNodeKind = "person" | "company";

export interface TvConnectionNode {
  /** Opaque, keyed hash that rotates on the server; never a user or enterprise id. */
  id: string;
  kind: TvConnectionNodeKind;
  /** Person: display name only while their profile is shared, else null (anonymous dot). Company: name. */
  label: string | null;
  /** Number of edges, so the view can size and focus without recounting. */
  degree: number;
}

export interface TvConnectionEdge {
  source: string;
  target: string;
}

/** Response of the unauthenticated GET /api/tv/connections (active edition only). */
export interface TvConnectionsResponse {
  nodes: TvConnectionNode[];
  edges: TvConnectionEdge[];
  /** True when the bounded snapshot dropped nodes or edges; totals still describe everything eligible. */
  truncated: boolean;
  totals: { people: number; companies: number; connections: number };
}
