/**
 * Deterministic BPMN 2.0 serialisation (delta v1.1 R5.2).
 *
 * A pure function: ProcessGraph → BPMN 2.0 XML, process semantics plus BPMN DI
 * for layout. The model never touches this — it is the whole point of R5.1 that
 * the graph is the canonical artefact and the XML is derived from it, so the same
 * graph always produces byte-identical XML.
 *
 * This file is the ARIS import path. It is named explicitly in the UI as
 * "Export BPMN 2.0 (ARIS-compatible)" so nobody has to guess what the download is.
 */
import { layoutGraph } from './layout';
import type { ProcessGraph } from './schema';

const NS = {
  bpmn: 'http://www.omg.org/spec/BPMN/20100524/MODEL',
  bpmndi: 'http://www.omg.org/spec/BPMN/20100524/DI',
  dc: 'http://www.omg.org/spec/DD/20100524/DC',
  di: 'http://www.omg.org/spec/DD/20100524/DI',
};

/**
 * Our graph ids carry a kind prefix ("act:diagnose") for readability, but a colon
 * is a namespace separator in XML — an unsanitised id produces a document that no
 * BPMN tool will open. Mapping is one-way and total, so round-tripping recovers
 * the original by the same substitution.
 */
export function xmlId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Element name for an event, by its type. */
function eventTag(type: 'start' | 'end' | 'boundary'): string {
  if (type === 'start') return 'startEvent';
  if (type === 'end') return 'endEvent';
  return 'boundaryEvent';
}

export interface BpmnOptions {
  /**
   * Bottleneck/risk/metric annotations become BPMN text annotations associated
   * with their target. Off by default for a clean ARIS import; the in-app view
   * renders them as overlays instead (R5.3).
   */
  includeAnnotations?: boolean;
}

/**
 * The short form of a condition, for the diagram only.
 *
 * Extracted conditions read like sentences — "Credit £500–£2,000 — Operations
 * Manager pathway" — because that is how someone describes a rule out loud. On a
 * diagram they are edge labels, and edge labels are conventionally two or three
 * words: the branch, not the reasoning. Long ones wrap to four lines each and
 * three of them leaving one gateway will collide however carefully they are
 * placed, because there is genuinely not room.
 *
 * So the label carries the discriminator and the full text stays in the graph,
 * where the evidence panel and the export can show it. Splitting on the em-dash
 * is not a guess: it is how the extractor phrases these, "answer — because".
 */
const shortCondition = (text: string): string => {
  const head = text.split(/\s+[—–-]\s+/)[0].trim();
  const candidate = head.length >= 2 && head.length <= 28 ? head : text.trim();
  return candidate.length <= 28 ? candidate : `${candidate.slice(0, 27).trimEnd()}…`;
};

export function toBpmnXml(graph: ProcessGraph, opts: BpmnOptions = {}): string {
  const layout = layoutGraph(graph);
  const pid = xmlId(`Process_${graph.processId}`);
  const collabId = xmlId(`Collaboration_${graph.processId}`);
  const participantId = xmlId(`Participant_${graph.processId}`);

  const laneMembers = new Map<string, string[]>();
  for (const n of [...graph.events, ...graph.activities, ...graph.gateways]) {
    laneMembers.set(n.laneId, [...(laneMembers.get(n.laneId) ?? []), n.id]);
  }

  // ── Process semantics ─────────────────────────────────────────────────────
  // Only lanes the layout kept: an empty lane is dropped there (nobody works in
  // it, so it is a band of blank space), and emitting one here without matching
  // DI would produce a lane with no bounds.
  const shownLanes = graph.lanes.filter((l) => layout.lanes.has(l.id));
  const lanes = shownLanes
    .map((l) => {
      const refs = (laneMembers.get(l.id) ?? [])
        .map((id) => `        <bpmn:flowNodeRef>${xmlId(id)}</bpmn:flowNodeRef>`)
        .join('\n');
      return `      <bpmn:lane id="${xmlId(l.id)}" name="${esc(l.name)}">\n${refs}\n      </bpmn:lane>`;
    })
    .join('\n');

  const incoming = (id: string) =>
    graph.flows
      .filter((f) => f.to === id)
      .map((f) => `      <bpmn:incoming>${xmlId(f.id)}</bpmn:incoming>`)
      .join('\n');
  const outgoing = (id: string) =>
    graph.flows
      .filter((f) => f.from === id)
      .map((f) => `      <bpmn:outgoing>${xmlId(f.id)}</bpmn:outgoing>`)
      .join('\n');

  function nodeXml(tag: string, id: string, name: string, extraAttr = ''): string {
    const kids = [incoming(id), outgoing(id)].filter(Boolean).join('\n');
    const open = `    <bpmn:${tag} id="${xmlId(id)}" name="${esc(name)}"${extraAttr}>`;
    return kids ? `${open}\n${kids}\n    </bpmn:${tag}>` : `${open}\n    </bpmn:${tag}>`;
  }

  const events = graph.events
    .map((e) =>
      nodeXml(
        eventTag(e.type),
        e.id,
        e.name,
        e.type === 'boundary' && e.attachedTo
          ? ` attachedToRef="${xmlId(e.attachedTo)}" cancelActivity="true"`
          : '',
      ),
    )
    .join('\n');

  const activities = graph.activities.map((a) => nodeXml('task', a.id, a.name)).join('\n');

  const gateways = graph.gateways
    .map((g) =>
      nodeXml(g.type === 'parallel' ? 'parallelGateway' : 'exclusiveGateway', g.id, g.name),
    )
    .join('\n');

  const flows = graph.flows
    .map(
      (f) =>
        `    <bpmn:sequenceFlow id="${xmlId(f.id)}" sourceRef="${xmlId(f.from)}" targetRef="${xmlId(
          f.to,
        )}"${f.condition ? ` name="${esc(shortCondition(f.condition))}"` : ''} />`,
    )
    .join('\n');

  const annotations = opts.includeAnnotations
    ? graph.annotations
        .map(
          (a) =>
            `    <bpmn:textAnnotation id="${xmlId(a.id)}">\n      <bpmn:text>${esc(
              `${a.kind.toUpperCase()}: ${a.text} (facet ${a.evidence.facet})`,
            )}</bpmn:text>\n    </bpmn:textAnnotation>\n    <bpmn:association id="${xmlId(
              `assoc_${a.id}`,
            )}" sourceRef="${xmlId(a.targetId)}" targetRef="${xmlId(a.id)}" />`,
        )
        .join('\n')
    : '';

  // ── BPMN DI ───────────────────────────────────────────────────────────────
  const laneShapes = shownLanes
    .map((l) => {
      const b = layout.lanes.get(l.id)!;
      return `      <bpmndi:BPMNShape id="${xmlId(l.id)}_di" bpmnElement="${xmlId(
        l.id,
      )}" isHorizontal="true">\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" />\n      </bpmndi:BPMNShape>`;
    })
    .join('\n');

  const nodeShapes = [...layout.nodes.values()]
    .map(
      (b) =>
        `      <bpmndi:BPMNShape id="${xmlId(b.id)}_di" bpmnElement="${xmlId(
          b.id,
        )}">\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.width}" height="${
          b.height
        }" />\n      </bpmndi:BPMNShape>`,
    )
    .join('\n');

  // Condition labels are placed explicitly, not left to the renderer.
  //
  // Without bounds, bpmn-js puts every label at its edge's midpoint. Where several
  // flows converge on a decision — which is exactly where the labels are — they
  // land on top of each other and on the boxes behind them. That is the "text
  // falling on blocks" a reader sees, and no amount of panning or zooming fixes
  // it, because the labels are genuinely in the same place.
  //
  // So: reserve a rectangle per label, and nudge it clear of everything already
  // reserved. Deterministic, so the same graph places labels the same way twice.
  // Sized from the text, not assumed. Conditions on a real process run to fifty
  // characters — "Credit £500–£2,000 — Operations Manager pathway" — which wraps to
  // four lines. Reserving a single line meant every one of them overlapped by three
  // times its own height, which is the overlap that survived the first two fixes.
  const LABEL_W = 132;
  // 12, not 19. The renderer wraps narrower than the bounds suggest, so a label
  // measured as one line arrives as two and sits on its neighbour. Under-estimating
  // costs a little empty space; over-estimating costs a collision.
  const CHARS_PER_LINE = 12;
  const LABEL_LINE_H = 13;
  const labelHeight = (text: string) =>
    Math.max(1, Math.min(6, Math.ceil(text.length / CHARS_PER_LINE))) * LABEL_LINE_H + 4;
  const placed: { x: number; y: number; width: number; height: number }[] = [
    ...[...layout.nodes.values()].map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height })),
  ];

  // Gateways and events render their name *outside* the shape, centred beneath it.
  // Reserving only the diamond left that text unclaimed, so a condition label
  // would sit neatly clear of the diamond and squarely on top of the question it
  // was answering — which is the collision that survived the first fix.
  for (const n of [...graph.gateways, ...graph.events]) {
    const box = layout.nodes.get(n.id);
    if (!box || !n.name) continue;
    const lines = Math.max(1, Math.ceil(n.name.length / 16));
    placed.push({
      x: box.x + box.width / 2 - 55,
      y: box.y + box.height + 2,
      width: 110,
      height: lines * 12 + 6,
    });
  }
  const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  function placeLabel(x: number, y: number, text: string) {
    const h = labelHeight(text);

    // Search along the flow as well as across it. Trying only vertical offsets put
    // every label from one decision in a single column, so they ran out of room and
    // stacked; stepping right lets a fan of conditions spread along their edges,
    // which is also where a reader looks for them.
    for (const dx of [0, 30, 60, -26, 90]) {
      for (const dy of [-(h / 2 + 14), h / 2 + 14, -(h + 30), h + 30, -(h * 1.6 + 40), h * 1.6 + 40]) {
        const rect = { x: x + dx - LABEL_W / 2, y: y + dy - h / 2, width: LABEL_W, height: h };
        if (!placed.some((p) => overlaps(rect, p))) {
          placed.push(rect);
          return rect;
        }
      }
    }

    // Nowhere clear. Park it well below rather than on top of something — a label
    // slightly adrift can be read; one printed over a box cannot.
    const fallback = { x: x - LABEL_W / 2, y: y + 120, width: LABEL_W, height: h };
    placed.push(fallback);
    return fallback;
  }

  const edges = graph.flows
    .map((f) => {
      const a = layout.nodes.get(f.from);
      const z = layout.nodes.get(f.to);
      if (!a || !z) return '';
      const x1 = Math.round(a.x + a.width);
      const y1 = Math.round(a.y + a.height / 2);
      const x2 = Math.round(z.x);
      const y2 = Math.round(z.y + z.height / 2);
      // An elbow when the lanes differ, a straight line when they do not.
      const mid = y1 === y2 ? '' : `\n        <di:waypoint x="${x2}" y="${y1}" />`;

      // Labelled edges get their bounds near the source, where the reader is
      // looking when they leave a decision — not at a midpoint that may be half a
      // diagram away from the choice it describes.
      let label = '';
      if (f.condition) {
        const r = placeLabel(x1 + 40, y1, shortCondition(f.condition));
        label = `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${Math.round(
          r.x,
        )}" y="${Math.round(r.y)}" width="${r.width}" height="${r.height}" />\n        </bpmndi:BPMNLabel>`;
      }

      return `      <bpmndi:BPMNEdge id="${xmlId(f.id)}_di" bpmnElement="${xmlId(
        f.id,
      )}">\n        <di:waypoint x="${x1}" y="${y1}" />${mid}\n        <di:waypoint x="${x2}" y="${y2}" />${label}\n      </bpmndi:BPMNEdge>`;
    })
    .filter(Boolean)
    .join('\n');

  const participantShape = `      <bpmndi:BPMNShape id="${participantId}_di" bpmnElement="${participantId}" isHorizontal="true">\n        <dc:Bounds x="0" y="0" width="${layout.width}" height="${layout.height}" />\n      </bpmndi:BPMNShape>`;

  const body = [lanes && `    <bpmn:laneSet id="${pid}_lanes">\n${lanes}\n    </bpmn:laneSet>`, events, activities, gateways, flows, annotations]
    .filter(Boolean)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="${NS.bpmn}" xmlns:bpmndi="${NS.bpmndi}" xmlns:dc="${NS.dc}" xmlns:di="${NS.di}" id="Definitions_${xmlId(graph.processId)}" targetNamespace="http://virginmediao2.co.uk/magpie" exporter="Magpie" exporterVersion="1.1">
  <bpmn:collaboration id="${collabId}">
    <bpmn:participant id="${participantId}" name="${esc(graph.name)}" processRef="${pid}" />
  </bpmn:collaboration>
  <bpmn:process id="${pid}" isExecutable="false">
${body}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${xmlId(graph.processId)}">
    <bpmndi:BPMNPlane id="BPMNPlane_${xmlId(graph.processId)}" bpmnElement="${collabId}">
${participantShape}
${laneShapes}
${nodeShapes}
${edges}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

// ── Round-trip (R5.2) ───────────────────────────────────────────────────────

export interface ExtractedElements {
  lanes: string[];
  startEvents: string[];
  endEvents: string[];
  boundaryEvents: string[];
  tasks: string[];
  gateways: string[];
  flows: { id: string; from: string; to: string }[];
  shapes: string[];
  edges: string[];
}

/**
 * Re-extract the element set from serialised XML. The round-trip assertion R5.2
 * asks for is `extract(toBpmnXml(g))` matching `g` — this is a regex reader rather
 * than a DOM parse so the check runs in Node without pulling bpmn-js into the test
 * path; bpmn-js opening the file is verified separately when the viewer lands.
 */
export function extractFromXml(xml: string): ExtractedElements {
  const ids = (tag: string) =>
    [...xml.matchAll(new RegExp(`<bpmn:${tag}\\s+id="([^"]+)"`, 'g'))].map((m) => m[1]);

  const flows = [...xml.matchAll(/<bpmn:sequenceFlow id="([^"]+)" sourceRef="([^"]+)" targetRef="([^"]+)"/g)].map(
    (m) => ({ id: m[1], from: m[2], to: m[3] }),
  );

  return {
    lanes: ids('lane'),
    startEvents: ids('startEvent'),
    endEvents: ids('endEvent'),
    boundaryEvents: ids('boundaryEvent'),
    tasks: ids('task'),
    gateways: [...ids('exclusiveGateway'), ...ids('parallelGateway')],
    flows,
    shapes: [...xml.matchAll(/<bpmndi:BPMNShape id="([^"]+)"/g)].map((m) => m[1]),
    edges: [...xml.matchAll(/<bpmndi:BPMNEdge id="([^"]+)"/g)].map((m) => m[1]),
  };
}
