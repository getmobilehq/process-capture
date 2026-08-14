/**
 * Deterministic layered layout for BPMN DI coordinates (delta v1.1 R5.2).
 *
 * The delta suggests elkjs "e.g.", not as a requirement. A layered left-to-right
 * layout over a graph this shape is a couple of hundred lines, and rolling it
 * keeps the serialiser a *pure synchronous function* — elkjs is async and would
 * make `toBpmnXml` a promise, which in turn makes the round-trip test and the
 * export route async. P6 says extend before adding; recorded in DECISIONS.
 *
 * Layering is longest-path from the start event, so a node always sits to the
 * right of everything that can reach it. Lanes own the vertical axis, which is
 * what makes the result read as a swimlane diagram rather than a graph dump.
 *
 * Geometry is computed in two passes, and that ordering is load-bearing: lane
 * heights depend on how many nodes stack inside them, and node positions depend
 * on where their lane ended up. Positioning nodes on a uniform grid while drawing
 * lanes on a variable one is exactly how a diagram ends up with its nodes in the
 * wrong bands.
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
const TASK_W = 160;
const TASK_MIN_H = 80;

const COL_GAP = 60;
const ROW_GAP = 28;
const LANE_PAD = 24;
const LANE_MIN_H = 100;
const LANE_LABEL_W = 30;
const PAD_X = 40;

/** Roughly how many characters of the label fit on one line inside a task box. */
const CHARS_PER_LINE = 22;
const LINE_H = 15;
const MAX_LINES = 7;

function nameOf(graph: ProcessGraph, id: string): string {
  return (
    graph.activities.find((a) => a.id === id)?.name ??
    graph.gateways.find((g) => g.id === id)?.name ??
    graph.events.find((e) => e.id === id)?.name ??
    ''
  );
}

/**
 * Tasks grow to fit their label. A fixed 80px box was the reason long activity
 * names spilled over their own borders and over whatever sat beneath them — the
 * diagram looked broken when the only thing wrong was the box.
 */
function sizeOf(graph: ProcessGraph, id: string): { width: number; height: number } {
  if (graph.events.some((e) => e.id === id)) return { width: EVENT, height: EVENT };
  if (graph.gateways.some((g) => g.id === id)) return { width: GATEWAY, height: GATEWAY };

  const words = nameOf(graph, id).split(/\s+/).filter(Boolean);
  let lines = 1;
  let used = 0;
  for (const w of words) {
    // +1 for the space we would have to add before this word.
    if (used > 0 && used + 1 + w.length > CHARS_PER_LINE) {
      lines += 1;
      used = w.length;
    } else {
      used += (used > 0 ? 1 : 0) + w.length;
    }
  }
  const height = Math.max(TASK_MIN_H, Math.min(lines, MAX_LINES) * LINE_H + 34);
  return { width: TASK_W, height };
}

/**
 * Longest-path layering. Cycles cannot extend a layer (a node never sits right of
 * itself), so a loop back to an earlier step degrades to a long edge rather than
 * hanging — process graphs legitimately contain rework loops.
 */
function assignLayers(graph: ProcessGraph): Map<string, number> {
  const layer = new Map<string, number>();
  const start = graph.events.find((e) => e.type === 'start');

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

  const laneOf = new Map<string, string>();
  for (const n of [...graph.events, ...graph.activities, ...graph.gateways]) {
    laneOf.set(n.id, n.laneId);
  }

  // A lane nobody works in is a band of empty space the reader has to scroll
  // past. Drop it — the graph says who is involved, not the lane list.
  const occupied = new Set([...laneOf.values()]);
  const lanesShown = graph.lanes.filter((l) => occupied.has(l.id));
  const laneOrder = (lanesShown.length > 0 ? lanesShown : graph.lanes).map((l) => l.id);
  const fallbackLane = laneOrder[0];

  const sizes = new Map<string, { width: number; height: number }>();
  for (const id of layer.keys()) sizes.set(id, sizeOf(graph, id));

  // ── Columns ────────────────────────────────────────────────────────────────
  const maxLayer = Math.max(0, ...[...layer.values()]);
  const colWidth: number[] = Array.from({ length: maxLayer + 1 }, () => 0);
  for (const [id, l] of layer) {
    colWidth[l] = Math.max(colWidth[l], sizes.get(id)!.width);
  }
  const colX: number[] = [];
  let cursor = LANE_LABEL_W + PAD_X;
  for (let l = 0; l <= maxLayer; l += 1) {
    colX[l] = cursor;
    cursor += colWidth[l] + COL_GAP;
  }
  const canvasWidth = cursor + PAD_X;

  // ── Pass one: how tall does each lane need to be? ──────────────────────────
  // Nodes sharing a lane *and* a layer stack vertically, so a lane is as tall as
  // its deepest stack. Deterministic order so the same graph always lays out the
  // same way — a diagram that moves between renders is one nobody trusts.
  const ordered = [...layer.keys()].sort();
  const seats = new Map<string, string[]>();
  for (const id of ordered) {
    const key = `${laneOf.get(id) ?? fallbackLane}:${layer.get(id)}`;
    seats.set(key, [...(seats.get(key) ?? []), id]);
  }

  const laneHeight = new Map<string, number>();
  for (const laneId of laneOrder) {
    let tallest = 0;
    for (let l = 0; l <= maxLayer; l += 1) {
      const stack = seats.get(`${laneId}:${l}`) ?? [];
      const h =
        stack.reduce((sum, id) => sum + sizes.get(id)!.height, 0) +
        Math.max(0, stack.length - 1) * ROW_GAP;
      tallest = Math.max(tallest, h);
    }
    laneHeight.set(laneId, Math.max(LANE_MIN_H, tallest + LANE_PAD * 2));
  }

  const laneY = new Map<string, number>();
  let y = 0;
  for (const laneId of laneOrder) {
    laneY.set(laneId, y);
    y += laneHeight.get(laneId)!;
  }
  const canvasHeight = Math.max(y, LANE_MIN_H);

  // ── Pass two: place nodes inside the lane they actually belong to ─────────
  const nodes = new Map<string, Box>();
  for (const [key, stack] of seats) {
    const laneId = key.slice(0, key.lastIndexOf(':'));
    const band = laneY.get(laneId);
    if (band === undefined) continue;
    const height = laneHeight.get(laneId)!;

    const stackH =
      stack.reduce((sum, id) => sum + sizes.get(id)!.height, 0) +
      Math.max(0, stack.length - 1) * ROW_GAP;
    let top = band + (height - stackH) / 2;

    for (const id of stack) {
      const size = sizes.get(id)!;
      const l = layer.get(id)!;
      nodes.set(id, {
        id,
        x: colX[l] + (colWidth[l] - size.width) / 2,
        y: top,
        width: size.width,
        height: size.height,
      });
      top += size.height + ROW_GAP;
    }
  }

  // A boundary event sits *on* its activity's edge. Offset from the centre, or it
  // lands on top of the activity's own label and reads as two overlapping shapes.
  for (const e of graph.events) {
    if (e.type !== 'boundary' || !e.attachedTo) continue;
    const host = nodes.get(e.attachedTo);
    const self = nodes.get(e.id);
    if (!host || !self) continue;
    nodes.set(e.id, {
      ...self,
      x: host.x + host.width * 0.75 - self.width / 2,
      y: host.y + host.height - self.height / 2,
    });
  }

  // ── Lane bands ────────────────────────────────────────────────────────────
  const lanes = new Map<string, Box>();
  for (const laneId of laneOrder) {
    lanes.set(laneId, {
      id: laneId,
      x: LANE_LABEL_W,
      y: laneY.get(laneId)!,
      width: canvasWidth - LANE_LABEL_W,
      height: laneHeight.get(laneId)!,
    });
  }

  return { nodes, lanes, width: canvasWidth, height: canvasHeight };
}
