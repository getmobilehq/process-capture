/**
 * Deterministic layered layout for BPMN DI coordinates (delta v1.1 R5.2).
 *
 * The delta suggests elkjs "e.g.", not as a requirement. A layered left-to-right
 * layout over a graph this shape is about eighty lines, and rolling it keeps the
 * serialiser a *pure synchronous function* — elkjs is async and would make
 * `toBpmnXml` a promise, which in turn makes the round-trip test and the export
 * route async for no gain. P6 says extend before adding; recorded in DECISIONS.
 *
 * Layering is longest-path from the start event, so a node always sits to the
 * right of everything that can reach it. Lanes own the vertical axis, which is
 * what makes the result read as a swimlane diagram rather than a graph dump.
 */
import type { ProcessGraph } from './schema';

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: Map<string, Box>;
  lanes: Map<string, Box>;
  /** Overall canvas, used for the participant band. */
  width: number;
  height: number;
}

// BPMN conventional sizes — events are circles, gateways diamonds, tasks rounded.
const EVENT = 36;
const GATEWAY = 50;
const TASK_W = 120;
const TASK_H = 80;

const COL_GAP = 60;
const ROW_H = 140;
const LANE_LABEL_W = 30;
const PAD_X = 40;

function sizeOf(graph: ProcessGraph, id: string): { width: number; height: number } {
  if (graph.events.some((e) => e.id === id)) return { width: EVENT, height: EVENT };
  if (graph.gateways.some((g) => g.id === id)) return { width: GATEWAY, height: GATEWAY };
  return { width: TASK_W, height: TASK_H };
}

/**
 * Longest-path layering. Cycles cannot extend a layer (a node never sits right of
 * itself), so a loop back to an earlier step degrades to a long edge rather than
 * hanging — process graphs legitimately contain rework loops.
 */
function assignLayers(graph: ProcessGraph): Map<string, number> {
  const layer = new Map<string, number>();
  const start = graph.events.find((e) => e.type === 'start');
  const outgoing = new Map<string, string[]>();
  for (const f of graph.flows) {
    outgoing.set(f.from, [...(outgoing.get(f.from) ?? []), f.to]);
  }

  const all = [
    ...graph.events.map((n) => n.id),
    ...graph.activities.map((n) => n.id),
    ...graph.gateways.map((n) => n.id),
  ];
  for (const id of all) layer.set(id, 0);

  // Relax |V| times; enough for the longest simple path, and bounded on cycles.
  for (let pass = 0; pass < all.length; pass += 1) {
    let changed = false;
    for (const f of graph.flows) {
      const next = (layer.get(f.from) ?? 0) + 1;
      if (next > (layer.get(f.to) ?? 0)) {
        layer.set(f.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // A boundary event belongs beside the activity it is attached to, not after it.
  for (const e of graph.events) {
    if (e.type === 'boundary' && e.attachedTo && layer.has(e.attachedTo)) {
      layer.set(e.id, layer.get(e.attachedTo)!);
    }
  }

  if (start) layer.set(start.id, 0);
  return layer;
}

export function layoutGraph(graph: ProcessGraph): LayoutResult {
  const layer = assignLayers(graph);
  const laneOrder = graph.lanes.map((l) => l.id);
  const laneIndex = new Map(laneOrder.map((id, i) => [id, i]));

  const laneOf = new Map<string, string>();
  for (const n of [...graph.events, ...graph.activities, ...graph.gateways]) {
    laneOf.set(n.id, n.laneId);
  }

  // Column x positions: each layer is as wide as its widest node.
  const maxLayer = Math.max(0, ...[...layer.values()]);
  const colWidth: number[] = Array.from({ length: maxLayer + 1 }, () => 0);
  for (const [id, l] of layer) {
    colWidth[l] = Math.max(colWidth[l], sizeOf(graph, id).width);
  }
  const colX: number[] = [];
  let cursor = LANE_LABEL_W + PAD_X;
  for (let l = 0; l <= maxLayer; l += 1) {
    colX[l] = cursor;
    cursor += colWidth[l] + COL_GAP;
  }
  const canvasWidth = cursor + PAD_X;

  // Within a lane and layer, stack nodes so two never overlap.
  const seatCount = new Map<string, number>();
  const nodes = new Map<string, Box>();

  for (const id of [...layer.keys()].sort()) {
    const l = layer.get(id)!;
    const lane = laneOf.get(id) ?? laneOrder[0];
    const row = laneIndex.get(lane) ?? 0;
    const key = `${lane}:${l}`;
    const seat = seatCount.get(key) ?? 0;
    seatCount.set(key, seat + 1);

    const { width, height } = sizeOf(graph, id);
    // Centre within the column, and within the lane band.
    const x = colX[l] + (colWidth[l] - width) / 2;
    const y = row * ROW_H + (ROW_H - height) / 2 + seat * (TASK_H + 20);
    nodes.set(id, { id, x, y, width, height });
  }

  // A boundary event sits *on* its activity's edge, which is what BPMN DI means
  // by attached — centring it in its own column would leave it floating.
  for (const e of graph.events) {
    if (e.type !== 'boundary' || !e.attachedTo) continue;
    const host = nodes.get(e.attachedTo);
    const self = nodes.get(e.id);
    if (!host || !self) continue;
    nodes.set(e.id, {
      ...self,
      x: host.x + host.width / 2 - self.width / 2,
      y: host.y + host.height - self.height / 2,
    });
  }

  // Lane bands are as tall as the deepest stack they contain.
  const lanes = new Map<string, Box>();
  let laneY = 0;
  for (const lane of graph.lanes) {
    const members = [...nodes.entries()].filter(([id]) => laneOf.get(id) === lane.id);
    const bottom = members.reduce((m, [, b]) => Math.max(m, b.y + b.height), laneY + ROW_H);
    const height = Math.max(ROW_H, bottom - laneY + 20);
    lanes.set(lane.id, {
      id: lane.id,
      x: LANE_LABEL_W,
      y: laneY,
      width: canvasWidth - LANE_LABEL_W,
      height,
    });
    laneY += height;
  }

  return { nodes, lanes, width: canvasWidth, height: Math.max(laneY, ROW_H) };
}
