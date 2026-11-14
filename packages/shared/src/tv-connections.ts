/** Public TV connections graph contract shared by API and web (#934, #935). */

/** Mode name added to the TV mode enum. */
export const TV_CONNECTIONS_MODE = "connections" as const;

export type TvConnectionNodeKind = "person" | "company";

export interface TvConnectionNode {
  /** Opaque, keyed hash that rotates on the server; never a user or enterprise id. */
  id: string;
  kind: TvConnectionNodeKind;
  /** Person: display name (surname rule applied); only people sharing their networking profile appear. Company: name. */
  label: string;
  /** Number of edges, so the view can size and focus without recounting. */
  degree: number;
  /** Company only: the public sponsor logo (same value as the sponsors TV mode); null or absent when none. */
  logoUrl?: string | null;
  /** Company only: dark-background variant, falling back to `logoUrl` like the sponsors TV mode. */
  logoNegativeUrl?: string | null;
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
