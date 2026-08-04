import { describe, it, expect } from 'vitest';
import { extractFromXml, toBpmnXml, xmlId } from '@/lib/graph/bpmn';
import { layoutGraph } from '@/lib/graph/layout';
import { validateGraph } from '@/lib/graph/validate';
import type { ProcessGraph } from '@/lib/graph/schema';

function graph(): ProcessGraph {
  return {
    processId: 'fault-management',
    name: 'Fault management',
    specRef: 'spec:v1',
    generatedAt: '2026-08-01T00:00:00.000Z',
    lanes: [
      { id: 'lane:customer', name: 'Customer', sourceFacet: 2 },
      { id: 'lane:agent', name: 'Contact centre agent', sourceFacet: 2 },
      { id: 'lane:tech', name: 'Field technician', sourceFacet: 2 },
    ],
    events: [
      { id: 'ev:start', type: 'start', name: 'Customer reports a fault', laneId: 'lane:customer', sourceFacet: 3 },
      { id: 'ev:not-home', type: 'boundary', name: 'Customer not home', laneId: 'lane:tech', sourceFacet: 10, attachedTo: 'act:visit' },
      { id: 'ev:end-fixed', type: 'end', name: 'Fixed remotely', laneId: 'lane:agent', sourceFacet: 1 },
      { id: 'ev:end-closed', type: 'end', name: 'Work order closed', laneId: 'lane:tech', sourceFacet: 1 },
    ],
    activities: [
      { id: 'act:diagnose', name: 'Run diagnostics', laneId: 'lane:agent', systems: ['ent:einstein'], sourceFacet: 5 },
      { id: 'act:visit', name: 'Technician visit', laneId: 'lane:tech', systems: [], sourceFacet: 5 },
    ],
    gateways: [
      { id: 'gw:nba', type: 'exclusive', name: 'Next best action', condition: '', laneId: 'lane:agent', sourceFacet: 6 },
    ],
    flows: [
      { id: 'f1', from: 'ev:start', to: 'act:diagnose' },
      { id: 'f2', from: 'act:diagnose', to: 'gw:nba' },
      { id: 'f3', from: 'gw:nba', to: 'ev:end-fixed', condition: 'remote fix' },
      { id: 'f4', from: 'gw:nba', to: 'act:visit', condition: 'engineer needed' },
      { id: 'f5', from: 'act:visit', to: 'ev:end-closed' },
      { id: 'f6', from: 'ev:not-home', to: 'act:visit', condition: 'rebook' },
    ],
    annotations: [
      {
        id: 'ann:not-home',
        targetId: 'act:visit',
        kind: 'bottleneck',
        text: 'Not-home visits force a rebook after a wasted roll',
        evidence: { facet: 12 },
      },
    ],
  };
}

describe('BPMN 2.0 serialisation (R5.2)', () => {
  it('serialises a valid graph to a well-formed document', () => {
    expect(validateGraph(graph()).ok).toBe(true);
    const xml = toBpmnXml(graph());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<bpmn:definitions');
    expect(xml).toContain('</bpmn:definitions>');
    expect(xml).toContain('<bpmndi:BPMNDiagram');
  });

  // Colons are namespace separators — an unsanitised id yields a file no BPMN
  // tool will open, which is the failure mode that matters for the ARIS path.
  it('sanitises ids into valid XML names', () => {
    expect(xmlId('act:diagnose')).toBe('act_diagnose');
    expect(xmlId('9lives')).toBe('_9lives');
    expect(toBpmnXml(graph())).not.toMatch(/id="[^"]*:[^"]*"/);
  });

  it('is deterministic — the same graph always yields identical XML', () => {
    expect(toBpmnXml(graph())).toBe(toBpmnXml(graph()));
  });

  // The round-trip assertion R5.2 asks for.
  it('round-trips: re-extracting the elements matches the graph', () => {
    const g = graph();
    const got = extractFromXml(toBpmnXml(g));

    expect(got.lanes.sort()).toEqual(g.lanes.map((l) => xmlId(l.id)).sort());
    expect(got.tasks.sort()).toEqual(g.activities.map((a) => xmlId(a.id)).sort());
    expect(got.gateways.sort()).toEqual(g.gateways.map((x) => xmlId(x.id)).sort());
    expect(got.startEvents).toEqual(['ev_start']);
    expect(got.endEvents.sort()).toEqual(['ev_end-closed', 'ev_end-fixed']);
    expect(got.boundaryEvents).toEqual(['ev_not-home']);

    expect(got.flows.map((f) => f.id).sort()).toEqual(g.flows.map((f) => f.id).sort());
    for (const f of g.flows) {
      const found = got.flows.find((x) => x.id === f.id)!;
      expect(found.from).toBe(xmlId(f.from));
      expect(found.to).toBe(xmlId(f.to));
    }
  });

  it('gives every node a DI shape and every flow a DI edge', () => {
    const g = graph();
    const got = extractFromXml(toBpmnXml(g));
    const nodeCount = g.events.length + g.activities.length + g.gateways.length;
    // + one shape per lane, + the participant band.
    expect(got.shapes).toHaveLength(nodeCount + g.lanes.length + 1);
    expect(got.edges).toHaveLength(g.flows.length);
  });

  it('attaches a boundary event to its activity', () => {
    expect(toBpmnXml(graph())).toContain('attachedToRef="act_visit"');
  });

  it('names conditional flows so a branch is readable', () => {
    const xml = toBpmnXml(graph());
    expect(xml).toContain('name="remote fix"');
    expect(xml).toContain('name="engineer needed"');
  });

  it('assigns every node to its lane', () => {
    const xml = toBpmnXml(graph());
    expect(xml).toMatch(/<bpmn:lane id="lane_agent"[\s\S]*?act_diagnose[\s\S]*?<\/bpmn:lane>/);
  });

  it('escapes characters that would otherwise break the document', () => {
    const g = graph();
    g.activities[0].name = 'Check "billing" & <notes>';
    const xml = toBpmnXml(g);
    expect(xml).toContain('Check &quot;billing&quot; &amp; &lt;notes&gt;');
    expect(xml).not.toContain('<notes>');
  });

  it('leaves annotations out by default and includes them on request', () => {
    expect(toBpmnXml(graph())).not.toContain('textAnnotation');
    const withNotes = toBpmnXml(graph(), { includeAnnotations: true });
    expect(withNotes).toContain('<bpmn:textAnnotation');
    expect(withNotes).toContain('BOTTLENECK: Not-home visits');
    expect(withNotes).toContain('facet 12');
  });
});

describe('layered layout (R5.2)', () => {
  it('places every node left of what follows it', () => {
    const g = graph();
    const { nodes } = layoutGraph(g);
    const start = nodes.get('ev:start')!;
    const diag = nodes.get('act:diagnose')!;
    const gw = nodes.get('gw:nba')!;
    expect(start.x).toBeLessThan(diag.x);
    expect(diag.x).toBeLessThan(gw.x);
  });

  it('separates lanes vertically so the result reads as swimlanes', () => {
    const { nodes } = layoutGraph(graph());
    expect(nodes.get('ev:start')!.y).not.toBe(nodes.get('act:diagnose')!.y);
    expect(nodes.get('act:visit')!.y).toBeGreaterThan(nodes.get('act:diagnose')!.y);
  });

  it('attaches a boundary event to its activity edge, not floating in a column', () => {
    const { nodes } = layoutGraph(graph());
    const host = nodes.get('act:visit')!;
    const boundary = nodes.get('ev:not-home')!;
    // Horizontally centred on the host, straddling its lower edge.
    expect(boundary.x + boundary.width / 2).toBe(host.x + host.width / 2);
    expect(boundary.y).toBe(host.y + host.height - boundary.height / 2);
  });

  it('terminates on a rework loop rather than hanging', () => {
    const g = graph();
    g.flows.push({ id: 'f7', from: 'act:visit', to: 'act:diagnose', condition: 'rework' });
    const { nodes } = layoutGraph(g);
    expect(nodes.size).toBe(g.events.length + g.activities.length + g.gateways.length);
  });
});
