import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import type { GraphSeriesOption } from "echarts/charts";
import type { ComposeOption } from "echarts/core";
import { nodeSize, type Positions } from "./connections-layout";

export type ConnectionsOption = ComposeOption<GraphSeriesOption>;

export interface ConnectionsPalette {
  person: string;
  company: string;
  edge: string;
  foreground: string;
  fontFamily: string;
}

export interface ConnectionsOptionInput {
  nodes: TvConnectionNode[];
  edges: TvConnectionEdge[];
  positions: Positions;
  width: number;
  height: number;
  palette: ConnectionsPalette;
  labelled: Set<string>;
  /** Members of the neighbourhood currently highlighted; null shows everything evenly. */
  focus: { hub: string; members: Set<string> } | null;
  animate: boolean;
}

const DIM_NODE = 0.14;
const DIM_EDGE = 0.04;

/**
 * ECharts graph option with fixed coordinates (`layout: "none"`): positions come
 * from `layoutGraph`, so ECharts never runs its own random, animated force
 * layout. Fully silent — no hover, focus or click state exists on a TV.
 */
export function buildConnectionsOption(input: ConnectionsOptionInput): ConnectionsOption {
  const { nodes, edges, positions, width, height, palette, labelled, focus, animate } = input;
  const unit = Math.max(0.4, Math.min(width, height) / 1000);
  const padX = Math.min(width, height) * 0.03;
  const spanX = Math.max(1, width - padX * 2);
  const spanY = Math.max(1, height - padX * 2);
  const ordered = [...nodes].sort((a, b) => a.degree - b.degree || (a.id < b.id ? -1 : 1));
  const inFocus = (id: string) => !focus || focus.members.has(id);

  return {
    animation: animate,
    animationDuration: 0,
    animationDurationUpdate: animate ? 700 : 0,
    series: [
      {
        type: "graph",
        layout: "none",
        silent: true,
        roam: false,
        left: 0,
        top: 0,
        width,
        height,
        zlevel: 0,
        edgeSymbol: ["none", "none"],
        labelLayout: { hideOverlap: true },
        emphasis: { scale: false },
        data: [
          // Invisible corner anchors pin the view's bounding box to the full
          // frame, so ECharts' fit-to-data never rescales the graph when the
          // outermost real node changes between snapshots.
          ...[
            [padX, padX],
            [padX + spanX, padX + spanY],
          ].map(([ax, ay], i) => ({
            id: `anchor-${i}`,
            name: "",
            x: ax,
            y: ay,
            symbolSize: 0,
            label: { show: false },
            itemStyle: { opacity: 0 },
          })),
          ...ordered.map((node) => {
            const point = positions.get(node.id) ?? { x: 0.5, y: 0.5 };
            const company = node.kind === "company";
            const lit = inFocus(node.id);
            const showLabel =
              Boolean(node.label) && (labelled.has(node.id) || focus?.hub === node.id);
            return {
              id: node.id,
              name: node.label ?? "",
              x: padX + point.x * spanX,
              y: padX + point.y * spanY,
              symbol: company ? "roundRect" : "circle",
              symbolSize: nodeSize(node.degree, node.kind, unit),
              itemStyle: {
                color: company ? palette.company : palette.person,
                opacity: lit ? 1 : DIM_NODE,
                borderColor: palette.foreground,
                borderWidth: company ? unit * 1.5 : 0,
              },
              label: {
                show: showLabel && lit,
                position: "right",
                distance: 4 * unit,
                color: palette.foreground,
                fontFamily: palette.fontFamily,
                fontSize: Math.round((company ? 17 : 14) * unit),
                fontWeight: company ? 700 : 500,
              },
            };
          }),
        ],
        links: edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          lineStyle: {
            color: palette.edge,
            width: Math.max(
              0.6,
              unit * (focus && inFocus(edge.source) && inFocus(edge.target) ? 2 : 1),
            ),
            opacity:
              !focus || (inFocus(edge.source) && inFocus(edge.target))
                ? focus
                  ? 0.8
                  : 0.35
                : DIM_EDGE,
            curveness: 0,
          },
        })),
      },
    ],
  };
}
