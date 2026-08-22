/**
 * Autonomy swimlane (R5.9) — a printable SVG, built in server-shaped code.
 *
 * Deliberately not the BPMN canvas. That view exists for an architect reading
 * process structure, and it is interactive, pannable and sized to a screen. This
 * is a different artefact for a different reader: one page, every step coloured by
 * autonomy level, lane by lane, meant to be printed and put in front of people who
 * will never open the tool.
 *
 * Rendering it as plain SVG rather than driving bpmn-js has three consequences
 * that matter. It prints at any size without rasterising. It needs no library at
 * all, so P6 holds. And the layout is a pure function of the data, which means the
 * same process produces the same picture every time — a diagram that shifts
 * between renders is one nobody trusts in a pack.
 */
import { LEVEL_META, type AutonomyLevel, type AutonomySet } from './autonomy-levels';
import type { ProcessGraph } from './schema';

const LANE_LABEL_W = 150;
const STEP_W = 190;
const STEP_H = 74;
const STEP_GAP_X = 18;
const STEP_GAP_Y = 14;
const LANE_PAD = 16;
const HEADER_H = 96;
const LEGEND_H = 84;
const PAGE_PAD = 28;

const CHARS_PER_LINE = 26;
const LINE_H = 13;
const MAX_LINES = 3;

function wrap(text: string, perLine = CHARS_PER_LINE, maxLines = MAX_LINES): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > perLine) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  // An elided label must say so, or a reader takes the truncation for the name.
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, perLine - 1)}…`;
  }
  return lines;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Flow order, so a lane reads the way the work happens rather than by id. */
function flowOrder(graph: ProcessGraph): Map<string, number> {
  const order = new Map<string, number>();
  for (const a of graph.activities) order.set(a.id, 0);
  for (let pass = 0; pass < graph.activities.length; pass += 1) {
    let changed = false;
    for (const f of graph.flows) {
      if (!order.has(f.from) || !order.has(f.to)) continue;
      const next = order.get(f.from)! + 1;
      if (next > order.get(f.to)!) {
        order.set(f.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return order;
}

export interface SwimlaneOptions {
  processName: string;
  informant: string;
  /** Steps per row within a lane before wrapping. Tuned for A4 landscape. */
  perRow?: number;
}

export function renderAutonomySwimlane(
  graph: ProcessGraph,
  set: AutonomySet,
  opts: SwimlaneOptions,
): string {
  const perRow = opts.perRow ?? 5;
  const levelOf = new Map(set.levels.map((l) => [l.activityId, l.level]));
  const order = flowOrder(graph);

  // Only lanes that hold work — an empty band is space a reader scrolls past.
  const lanes = graph.lanes
    .map((l) => ({
      lane: l,
      steps: graph.activities
        .filter((a) => a.laneId === l.id)
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || a.id.localeCompare(b.id)),
    }))
    .filter((l) => l.steps.length > 0);

  const laneHeight = (n: number) => {
    const rows = Math.max(1, Math.ceil(n / perRow));
    return rows * STEP_H + (rows - 1) * STEP_GAP_Y + LANE_PAD * 2;
  };

  const width = LANE_LABEL_W + perRow * STEP_W + (perRow - 1) * STEP_GAP_X + PAGE_PAD * 2;
  const bodyHeight = lanes.reduce((h, l) => h + laneHeight(l.steps.length), 0);
  const height = HEADER_H + bodyHeight + LEGEND_H + PAGE_PAD;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Aeonik Pro, Calibri, system-ui, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
  );

  // ── Header ────────────────────────────────────────────────────────────────
  out.push(
    `<text x="${PAGE_PAD}" y="42" font-size="24" font-weight="700" fill="#451b4f">${esc(opts.processName)}</text>`,
    `<text x="${PAGE_PAD}" y="64" font-size="12.5" fill="#5a5a5a">Autonomy assessment — how far each step could run without a person</text>`,
    `<text x="${PAGE_PAD}" y="82" font-size="11" fill="#8a8a8a">As described by ${esc(opts.informant)} · proposed and unverified · not a recommendation to proceed</text>`,
  );

  // ── Lanes ─────────────────────────────────────────────────────────────────
  let y = HEADER_H;
  for (const { lane, steps } of lanes) {
    const h = laneHeight(steps.length);

    out.push(
      `<rect x="${PAGE_PAD}" y="${y}" width="${width - PAGE_PAD * 2}" height="${h}" fill="#faf8fb" stroke="#e4d5ea" stroke-width="1"/>`,
      `<rect x="${PAGE_PAD}" y="${y}" width="${LANE_LABEL_W}" height="${h}" fill="#f7f1f9" stroke="#e4d5ea" stroke-width="1"/>`,
    );
    for (const [i, line] of wrap(lane.name, 18, 3).entries()) {
      out.push(
        `<text x="${PAGE_PAD + 14}" y="${y + LANE_PAD + 18 + i * 15}" font-size="12.5" font-weight="700" fill="#451b4f">${esc(line)}</text>`,
      );
    }

    steps.forEach((step, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = PAGE_PAD + LANE_LABEL_W + 14 + col * (STEP_W + STEP_GAP_X);
      const sy = y + LANE_PAD + row * (STEP_H + STEP_GAP_Y);
      const level = (levelOf.get(step.id) ?? 'unassessed') as AutonomyLevel;
      const meta = LEVEL_META[level];

      out.push(
        `<rect x="${x}" y="${sy}" width="${STEP_W}" height="${STEP_H}" rx="8" fill="${meta.fill}" stroke="${meta.border}" stroke-width="1.5"/>`,
        // The level is written as text, not signalled by colour alone — the
        // diagram has to survive being printed in black and white.
        `<text x="${x + 12}" y="${sy + 20}" font-size="12" font-weight="700" fill="${meta.ink}">${meta.title === '?' ? 'Not assessed' : meta.title}</text>`,
      );
      for (const [li, line] of wrap(step.name).entries()) {
        out.push(
          `<text x="${x + 12}" y="${sy + 38 + li * LINE_H}" font-size="10.5" fill="#1a1a1a">${esc(line)}</text>`,
        );
      }
    });

    y += h;
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendY = y + 22;
  out.push(
    `<text x="${PAGE_PAD}" y="${legendY}" font-size="11" font-weight="700" fill="#712d85">THE SCALE</text>`,
  );
  const order4: AutonomyLevel[] = ['L3', 'L2', 'L1', 'L0'];
  const swatchW = Math.min(230, (width - PAGE_PAD * 2) / 4 - 10);
  order4.forEach((lv, i) => {
    const meta = LEVEL_META[lv];
    const x = PAGE_PAD + i * (swatchW + 10);
    out.push(
      `<rect x="${x}" y="${legendY + 10}" width="${swatchW}" height="34" rx="6" fill="${meta.fill}" stroke="${meta.border}" stroke-width="1.5"/>`,
      `<text x="${x + 10}" y="${legendY + 25}" font-size="11.5" font-weight="700" fill="${meta.ink}">${meta.title}</text>`,
      `<text x="${x + 10}" y="${legendY + 38}" font-size="9.5" fill="#4a4550">${esc(meta.gloss)}</text>`,
    );
  });

  out.push('</svg>');
  return out.join('\n');
}
