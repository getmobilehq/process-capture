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
  const lanes = graph.lanes
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
        )}"${f.condition ? ` name="${esc(f.condition)}"` : ''} />`,
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
  const laneShapes = graph.lanes
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
      return `      <bpmndi:BPMNEdge id="${xmlId(f.id)}_di" bpmnElement="${xmlId(
        f.id,
      )}">\n        <di:waypoint x="${x1}" y="${y1}" />${mid}\n        <di:waypoint x="${x2}" y="${y2}" />\n      </bpmndi:BPMNEdge>`;
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
