/**
 * Graph helpers over a flow definition. Pure functions: each returns a new
 * definition and leaves its input alone, so the history stack can hold
 * snapshots without defensive copying at every call site.
 */

import {
	DEFAULT_IN_PORT,
	DEFAULT_OUT_PORT,
	TRIGGER_ID,
	type FlowDefinition,
	type FlowEdge,
	type FlowNode,
	type FlowNote,
	type NodeSpec,
	type Port,
	type Position,
	DEFAULT_SETTINGS,
} from './types';

/** A deep copy that survives a Svelte 5 proxy, which structuredClone does not. */
export function cloneDefinition(def: FlowDefinition): FlowDefinition {
	return JSON.parse(JSON.stringify(def)) as FlowDefinition;
}

/**
 * The engine leaves an empty config, an empty edge list and empty notes out
 * of the wire shape, so a definition read back from it can carry undefined
 * where the editor expects an object or a list. Fill them once at the door.
 */
export function normalizeDefinition(def: FlowDefinition): FlowDefinition {
	const out = cloneDefinition(def);
	out.version = 1;
	const trigger = out.trigger ?? { type: 'trigger.http', config: { method: 'GET', auth: 'auth' } };
	out.trigger = { type: trigger.type || 'trigger.http', config: trigger.config ?? {} };
	// A stored card position survives the rebuild.
	const at = trigger.position;
	if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) out.trigger.position = { x: at.x, y: at.y };
	out.settings = { ...DEFAULT_SETTINGS, ...(out.settings ?? {}) };
	out.nodes = (out.nodes ?? []).map((n) => ({ ...n, config: n.config ?? {} }));
	out.edges = out.edges ?? [];
	out.notes = out.notes ?? [];
	return out;
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			const v = (value as Record<string, unknown>)[key];
			if (v !== undefined) out[key] = sortKeys(v);
		}
		return out;
	}
	return value;
}

/**
 * The definition as one comparable string: keys sorted at every depth and
 * undefined dropped. Two definitions that mean the same thing serialize the
 * same way whatever order the canvas, the inspector or an undo wrote their
 * keys in, so "is the draft dirty" is a string comparison against the last
 * saved one and not a flag that an undo can leave wrong.
 */
export function cleanJSON(def: FlowDefinition): string {
	return JSON.stringify(sortKeys(def));
}

export function nodeById(def: FlowDefinition, id: string): FlowNode | undefined {
	return def.nodes.find((n) => n.id === id);
}

export function specFor(catalog: NodeSpec[], type: string): NodeSpec | undefined {
	return catalog.find((s) => s.type === type);
}

export function fromPort(e: FlowEdge): string {
	return e.from_port ?? DEFAULT_OUT_PORT;
}

export function toPort(e: FlowEdge): string {
	return e.to_port ?? DEFAULT_IN_PORT;
}

/** A stable key for an edge, used as the selection id and the render key. */
export function edgeId(e: FlowEdge): string {
	return `${e.from}:${fromPort(e)}>${e.to}:${toPort(e)}`;
}

export function findEdge(def: FlowDefinition, id: string): FlowEdge | undefined {
	return def.edges.find((e) => edgeId(e) === id);
}

/**
 * The ports the trigger exposes. The catalog describes trigger types with no
 * outputs because the compiler synthesizes the node, so the canvas gives the
 * root one output port of its own.
 */
export const TRIGGER_OUTPUTS: Port[] = [{ name: DEFAULT_OUT_PORT, label: 'out' }];

/**
 * The ports of a node whose type the catalog does not list: the ones its
 * edges already use, plus the default so a new edge has somewhere to land.
 * Without them the node would draw as a box with no ports and every edge into
 * or out of it would vanish, which reads as a flow with fewer connections than
 * the engine would run.
 */
function portsFromEdges(names: string[], fallback: string): Port[] {
	const seen = new Set<string>([fallback, ...names]);
	return [...seen].map((name) => ({ name, multiple: true }));
}

export function outputsOf(def: FlowDefinition, catalog: NodeSpec[], id: string): Port[] {
	if (id === TRIGGER_ID) return TRIGGER_OUTPUTS;
	const node = nodeById(def, id);
	if (!node) return [];
	const spec = specFor(catalog, node.type);
	if (spec) return spec.outputs ?? [];
	return portsFromEdges(def.edges.filter((e) => e.from === id).map(fromPort), DEFAULT_OUT_PORT);
}

export function inputsOf(def: FlowDefinition, catalog: NodeSpec[], id: string): Port[] {
	const node = nodeById(def, id);
	if (!node) return [];
	const spec = specFor(catalog, node.type);
	if (spec) return spec.inputs ?? [];
	return portsFromEdges(def.edges.filter((e) => e.to === id).map(toPort), DEFAULT_IN_PORT);
}

/** Whether adding an edge from `from` to `to` would close a cycle. */
export function wouldCycle(def: FlowDefinition, from: string, to: string): boolean {
	if (from === to) return true;
	const seen = new Set<string>();
	const stack = [to];
	while (stack.length > 0) {
		const cur = stack.pop() as string;
		if (cur === from) return true;
		if (seen.has(cur)) continue;
		seen.add(cur);
		for (const e of def.edges) if (e.from === cur) stack.push(e.to);
	}
	return false;
}

export interface ConnectVerdict {
	ok: boolean;
	reason?: string;
}

/**
 * Whether an edge may be added. The engine validates the same rules on save.
 * Refusing here is what keeps a drag from drawing an edge the save then
 * rejects with a message about a node the reader is no longer looking at.
 */
export function canConnect(
	def: FlowDefinition,
	catalog: NodeSpec[],
	from: string,
	fromPortName: string,
	to: string,
	toPortName: string
): ConnectVerdict {
	if (to === TRIGGER_ID) return { ok: false, reason: 'The trigger has no inputs' };
	if (from === to) return { ok: false, reason: 'A node cannot feed itself' };
	if (!outputsOf(def, catalog, from).some((p) => p.name === fromPortName)) {
		return { ok: false, reason: `No output port ${fromPortName}` };
	}
	const target = inputsOf(def, catalog, to).find((p) => p.name === toPortName);
	if (!target) return { ok: false, reason: `No input port ${toPortName}` };
	const candidate: FlowEdge = { from, to, from_port: fromPortName, to_port: toPortName };
	if (def.edges.some((e) => edgeId(e) === edgeId(candidate))) {
		return { ok: false, reason: 'That edge already exists' };
	}
	if (!target.multiple && def.edges.some((e) => e.to === to && toPort(e) === toPortName)) {
		return { ok: false, reason: `Port ${toPortName} takes one edge` };
	}
	if (wouldCycle(def, from, to)) return { ok: false, reason: 'That would create a cycle' };
	return { ok: true };
}

/** Adds an edge, writing the default port names out only when they differ from the defaults. */
export function addEdge(
	def: FlowDefinition,
	from: string,
	fromPortName: string,
	to: string,
	toPortName: string
): FlowDefinition {
	const edge: FlowEdge = { from, to };
	if (fromPortName !== DEFAULT_OUT_PORT) edge.from_port = fromPortName;
	if (toPortName !== DEFAULT_IN_PORT) edge.to_port = toPortName;
	return { ...def, edges: [...def.edges, edge] };
}

export function removeEdge(def: FlowDefinition, id: string): FlowDefinition {
	return { ...def, edges: def.edges.filter((e) => edgeId(e) !== id) };
}

/** Removes nodes and every edge that touched them. */
export function removeNodes(def: FlowDefinition, ids: Iterable<string>): FlowDefinition {
	const gone = new Set(ids);
	return {
		...def,
		nodes: def.nodes.filter((n) => !gone.has(n.id)),
		edges: def.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
	};
}

export function removeNote(def: FlowDefinition, id: string): FlowDefinition {
	return { ...def, notes: (def.notes ?? []).filter((n) => n.id !== id) };
}

/**
 * A fresh node id derived from the type: `content.query` becomes
 * `content_query`, then `content_query_2` and so on while the name is taken.
 */
export function freshId(def: FlowDefinition, type: string): string {
	const base = type
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^[^a-z]+/, '')
		.replace(/_+$/, '')
		.slice(0, 36) || 'node';
	const taken = new Set([
		TRIGGER_ID,
		...def.nodes.map((n) => n.id),
		...(def.notes ?? []).map((n) => n.id),
	]);
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) {
		const candidate = `${base}_${i}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Adds a node of a catalog type at a point, seeded with the spec's example config. */
export function addNode(def: FlowDefinition, spec: NodeSpec, position: Position): FlowDefinition {
	const node: FlowNode = {
		id: freshId(def, spec.type),
		type: spec.type,
		name: spec.label,
		position: { x: Math.round(position.x), y: Math.round(position.y) },
		config: JSON.parse(JSON.stringify(spec.example ?? {})) as Record<string, unknown>,
	};
	return { ...def, nodes: [...def.nodes, node] };
}

export function addNote(def: FlowDefinition, position: Position): FlowDefinition {
	const note: FlowNote = {
		id: freshId(def, 'note'),
		text: '',
		position: { x: Math.round(position.x), y: Math.round(position.y) },
		width: 220,
		height: 100,
	};
	return { ...def, notes: [...(def.notes ?? []), note] };
}

export function updateNode(
	def: FlowDefinition,
	id: string,
	patch: Partial<FlowNode>
): FlowDefinition {
	return { ...def, nodes: def.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function updateNote(
	def: FlowDefinition,
	id: string,
	patch: Partial<FlowNote>
): FlowDefinition {
	return {
		...def,
		notes: (def.notes ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)),
	};
}

export function moveNodes(
	def: FlowDefinition,
	ids: Iterable<string>,
	dx: number,
	dy: number,
	/** Where the trigger is drawn now, for a trigger that has no stored position yet. */
	triggerAt?: Position
): FlowDefinition {
	const moving = new Set(ids);
	const shift = (p: Position): Position => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
	const trigger =
		moving.has(TRIGGER_ID) && (def.trigger.position ?? triggerAt)
			? { ...def.trigger, position: shift((def.trigger.position ?? triggerAt) as Position) }
			: def.trigger;
	return {
		...def,
		trigger,
		nodes: def.nodes.map((n) => (moving.has(n.id) ? { ...n, position: shift(n.position) } : n)),
		notes: (def.notes ?? []).map((n) =>
			moving.has(n.id) ? { ...n, position: shift(n.position) } : n
		),
	};
}

/** Nodes with no inbound edge. They start at once with the trigger payload. */
export function rootNodes(def: FlowDefinition): FlowNode[] {
	const fed = new Set(def.edges.filter((e) => e.from !== TRIGGER_ID).map((e) => e.to));
	return def.nodes.filter((n) => !fed.has(n.id));
}

/**
 * Each node's depth: the longest path from a root, which is the column the
 * auto layout puts it in. A node reached only through a cycle keeps depth 0
 * rather than hanging the walk.
 */
export function topoDepths(def: FlowDefinition): Map<string, number> {
	const depth = new Map<string, number>();
	const inbound = new Map<string, number>();
	for (const n of def.nodes) {
		depth.set(n.id, 0);
		inbound.set(n.id, 0);
	}
	const edges = def.edges.filter((e) => depth.has(e.from) && depth.has(e.to));
	for (const e of edges) inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
	const queue = def.nodes.filter((n) => inbound.get(n.id) === 0).map((n) => n.id);
	while (queue.length > 0) {
		const id = queue.shift() as string;
		const d = depth.get(id) ?? 0;
		for (const e of edges) {
			if (e.from !== id) continue;
			depth.set(e.to, Math.max(depth.get(e.to) ?? 0, d + 1));
			const left = (inbound.get(e.to) ?? 1) - 1;
			inbound.set(e.to, left);
			if (left === 0) queue.push(e.to);
		}
	}
	return depth;
}

/** The config keys that hold a value, in schema order, for the node body. */
export function configSummary(
	node: FlowNode,
	spec: NodeSpec | undefined,
	limit = 3
): { key: string; value: string }[] {
	const order = Object.keys(spec?.config_schema?.properties ?? {});
	const keys = [...order, ...Object.keys(node.config).filter((k) => !order.includes(k))];
	const out: { key: string; value: string }[] = [];
	for (const key of keys) {
		const v = node.config[key];
		if (v === undefined || v === null || v === '') continue;
		if (Array.isArray(v) && v.length === 0) continue;
		if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
		out.push({ key, value: brief(v) });
		if (out.length >= limit) break;
	}
	return out;
}

function brief(v: unknown): string {
	const s = typeof v === 'string' ? v : JSON.stringify(v);
	return s.length > 28 ? `${s.slice(0, 25)}...` : s;
}
