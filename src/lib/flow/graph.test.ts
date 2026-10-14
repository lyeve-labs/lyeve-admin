import { describe, expect, it } from 'vitest';
import { addEdge, addNode, canConnect, cleanJSON, configSummary, freshId, inputsOf, moveNodes, normalizeDefinition, outputsOf, removeNodes, rootNodes, topoDepths, wouldCycle } from './graph';
import { TRIGGER_ID } from './types';
import type { FlowDefinition } from './types';
import { fixtureCatalog, joinFlow } from './fixtures';

const querySpec = fixtureCatalog.find((s) => s.type === 'content.query')!;

describe('canConnect', () => {
	it('accepts an edge between declared ports', () => {
		const def = { ...joinFlow, edges: [] };
		expect(canConnect(def, fixtureCatalog, 'orders', 'out', 'join', 'left')).toEqual({ ok: true });
	});

	it('refuses a duplicate', () => {
		expect(canConnect(joinFlow, fixtureCatalog, 'orders', 'out', 'join', 'left').ok).toBe(false);
	});

	it('refuses a second edge into a port that takes one', () => {
		const verdict = canConnect(joinFlow, fixtureCatalog, 'shipments', 'out', 'join', 'left');
		expect(verdict.ok).toBe(false);
		expect(verdict.reason).toContain('one edge');
	});

	it('accepts a second edge into a port marked multiple', () => {
		const def = addNode(joinFlow, fixtureCatalog.find((s) => s.type === 'response')!, { x: 0, y: 0 });
		const withOne = addEdge(def, 'join', 'out', 'response', 'in');
		expect(canConnect(withOne, fixtureCatalog, 'orders', 'out', 'response', 'in').ok).toBe(true);
	});

	it('refuses a cycle', () => {
		const verdict = canConnect(joinFlow, fixtureCatalog, 'join', 'out', 'orders', 'in');
		expect(verdict.ok).toBe(false);
		expect(verdict.reason).toContain('cycle');
		expect(wouldCycle(joinFlow, 'join', 'orders')).toBe(true);
	});

	it('refuses an undeclared port and the trigger as a target', () => {
		expect(canConnect(joinFlow, fixtureCatalog, 'orders', 'out', 'join', 'middle').ok).toBe(false);
		expect(canConnect(joinFlow, fixtureCatalog, 'orders', 'out', 'trigger', 'in').ok).toBe(false);
	});
});

describe('addEdge', () => {
	it('writes only the port names that differ from the defaults', () => {
		const def = addEdge({ ...joinFlow, edges: [] }, 'orders', 'out', 'join', 'left');
		expect(def.edges).toEqual([{ from: 'orders', to: 'join', to_port: 'left' }]);
	});
});

describe('freshId', () => {
	it('derives the id from the type and counts up past the taken ones', () => {
		expect(freshId(joinFlow, 'data.join')).toBe('data_join');
		const withOne = addNode(joinFlow, querySpec, { x: 0, y: 0 });
		expect(withOne.nodes.at(-1)?.id).toBe('content_query');
		const withTwo = addNode(withOne, querySpec, { x: 0, y: 0 });
		expect(withTwo.nodes.at(-1)?.id).toBe('content_query_2');
	});

	it('seeds the new node with the example config', () => {
		const def = addNode(joinFlow, querySpec, { x: 10.6, y: 20.2 });
		const node = def.nodes.at(-1)!;
		expect(node.config).toEqual(querySpec.example);
		expect(node.config).not.toBe(querySpec.example);
		expect(node.position).toEqual({ x: 11, y: 20 });
	});
});

describe('removeNodes', () => {
	it('drops the edges that touched the node', () => {
		const def = removeNodes(joinFlow, ['join']);
		expect(def.nodes.map((n) => n.id)).toEqual(['orders', 'shipments']);
		expect(def.edges).toEqual([]);
	});
});

describe('topoDepths and rootNodes', () => {
	it('names the roots and their depth', () => {
		expect(rootNodes(joinFlow).map((n) => n.id)).toEqual(['orders', 'shipments']);
		const depth = topoDepths(joinFlow);
		expect(depth.get('orders')).toBe(0);
		expect(depth.get('join')).toBe(1);
	});
});

describe('configSummary', () => {
	it('lists the first three set keys in schema order', () => {
		const orders = joinFlow.nodes[0];
		expect(configSummary(orders, querySpec).map((s) => s.key)).toEqual(['schema', 'populate', 'limit']);
	});

	it('skips empty values', () => {
		const node = { ...joinFlow.nodes[0], config: { schema: '', filters: {}, populate: [], limit: 5 } };
		expect(configSummary(node, querySpec).map((s) => s.key)).toEqual(['limit']);
	});
});

describe('cleanJSON', () => {
	it('serializes the same definition the same way whatever the key order', () => {
		const reordered = JSON.parse(JSON.stringify(joinFlow)) as typeof joinFlow;
		reordered.nodes = reordered.nodes.map((n) => ({ config: n.config, position: n.position, type: n.type, name: n.name, id: n.id }));
		expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(joinFlow));
		expect(cleanJSON(reordered)).toBe(cleanJSON(joinFlow));
	});

	it('ignores a key set to undefined', () => {
		const explicit = { ...joinFlow, nodes: joinFlow.nodes.map((n) => ({ ...n, name: undefined })) };
		const absent = { ...joinFlow, nodes: joinFlow.nodes.map(({ name: _name, ...rest }) => rest) };
		expect(cleanJSON(explicit)).toBe(cleanJSON(absent));
	});

	it('tells two different definitions apart', () => {
		expect(cleanJSON({ ...joinFlow, name: 'other' })).not.toBe(cleanJSON(joinFlow));
	});
});

describe('ports of a node the catalog does not list', () => {
	const retired = { ...joinFlow, nodes: joinFlow.nodes.map((n) => (n.id === 'join' ? { ...n, type: 'data.retired' } : n)) };

	it('are the ports its edges use plus the default', () => {
		expect(inputsOf(retired, fixtureCatalog, 'join').map((p) => p.name)).toEqual(['in', 'left', 'right']);
		expect(outputsOf(retired, fixtureCatalog, 'join').map((p) => p.name)).toEqual(['out']);
	});

	it('still accept a new edge', () => {
		expect(canConnect(retired, fixtureCatalog, 'orders', 'out', 'join', 'in').ok).toBe(true);
	});
});

describe('normalizeDefinition', () => {
	it('gives a bare draft a trigger and settings', () => {
		const def = normalizeDefinition({} as unknown as FlowDefinition);
		expect(def.trigger).toEqual({ type: 'trigger.http', config: { method: 'GET', auth: 'auth' } });
		expect(def.settings).toEqual({ timeout: '10s', step_timeout: '5s', max_steps: 200, on_error: 'stop' });
		expect(def.nodes).toEqual([]);
	});

	it('fills the config, edges and notes the engine leaves out', () => {
		const wire = {
			version: 1,
			name: 'Bare',
			slug: 'bare',
			trigger: { type: 'trigger.manual' },
			settings: {},
			nodes: [{ id: 'fan_out', type: 'control.parallel', position: { x: 0, y: 0 } }]
		} as unknown as FlowDefinition;
		const def = normalizeDefinition(wire);
		expect(def.nodes[0].config).toEqual({});
		expect(def.trigger.config).toEqual({});
		expect(def.settings.timeout).toBe('10s');
		expect(def.settings.on_error).toBe('stop');
		expect(def.edges).toEqual([]);
		expect(def.notes).toEqual([]);
		expect(configSummary(def.nodes[0], undefined)).toEqual([]);
	});
});

describe('the trigger position', () => {
	const def = (): FlowDefinition =>
		normalizeDefinition({
			trigger: { type: 'trigger.manual', config: {} },
			nodes: [{ id: 'a', type: 'log', position: { x: 300, y: 100 }, config: {} }],
			edges: [],
		} as unknown as FlowDefinition);

	it('moves only the trigger when the trigger is dragged, seeding from where it is drawn', () => {
		const moved = moveNodes(def(), [TRIGGER_ID], 10, 20, { x: 40, y: 100 });
		expect(moved.trigger.position).toEqual({ x: 50, y: 120 });
		expect(moved.nodes[0].position).toEqual({ x: 300, y: 100 });
	});

	it('leaves the trigger unplaced when a node is dragged', () => {
		const moved = moveNodes(def(), ['a'], 10, 0, { x: 40, y: 100 });
		expect(moved.trigger.position).toBeUndefined();
		expect(moved.nodes[0].position).toEqual({ x: 310, y: 100 });
	});

	it('keeps a stored position through normalizing and ignores one that is not a point', () => {
		const kept = normalizeDefinition({ ...def(), trigger: { type: 'trigger.manual', config: {}, position: { x: 1, y: 2 } } });
		expect(kept.trigger.position).toEqual({ x: 1, y: 2 });
		const junk = normalizeDefinition({ ...def(), trigger: { type: 'trigger.manual', config: {}, position: { x: 'a', y: 2 } as never } });
		expect(junk.trigger.position).toBeUndefined();
	});
});
