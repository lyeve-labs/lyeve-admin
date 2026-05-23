import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import { FlowRefusal, getCatalog, getEventTypes, listDatasources, listPublishedFlows, refusalAware, refusalOf } from './flows';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function clientFor(route: (url: string) => Response) {
	const calls: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		calls.push(String(url));
		return route(String(url));
	}) as unknown as typeof globalThis.fetch;
	return { client: createClient(fetch, {}), calls };
}

const flow = (i: number) => ({ id: `f${i}`, slug: `flow-${i}`, name: `Flow ${i}` });

describe('listPublishedFlows', () => {
	it('asks for the active flows a page at a time until a short page', async () => {
		const { client, calls } = clientFor((url) => {
			const offset = Number(new URL(url, 'http://x').searchParams.get('offset'));
			const rows = offset === 0 ? Array.from({ length: 200 }, (_, i) => flow(i)) : [flow(200)];
			return json({ data: rows, total: 201 });
		});
		const flows = await listPublishedFlows(client);
		expect(flows).toHaveLength(201);
		expect(flows[0]).toEqual({ id: 'f0', slug: 'flow-0', name: 'Flow 0' });
		expect(calls).toHaveLength(2);
		expect(calls[0]).toContain('status=active');
		expect(calls[0]).toContain('limit=200');
		expect(calls[1]).toContain('offset=200');
	});

	it('stops at the cap so a tenant with thousands of flows does not stall the editor', async () => {
		const { client, calls } = clientFor(() => json({ data: Array.from({ length: 200 }, (_, i) => flow(i)) }));
		const flows = await listPublishedFlows(client, 400);
		expect(flows).toHaveLength(400);
		expect(calls).toHaveLength(2);
	});
});

describe('getEventTypes', () => {
	it('reads both lists and drops a system row with no name', async () => {
		const { client } = clientFor(() =>
			json({
				content: ['after_create'],
				system: [{ name: 'flow.run_failed', plugin: 'flow', description: 'A flow run ended failed.' }, { plugin: 'x' }, { name: 'bare' }],
			})
		);
		expect(await getEventTypes(client)).toEqual({
			content: ['after_create'],
			system: [
				{ name: 'flow.run_failed', plugin: 'flow', description: 'A flow run ended failed.' },
				{ name: 'bare', plugin: '', description: '' },
			],
		});
	});

	it('answers empty lists for a body with neither', async () => {
		const { client } = clientFor(() => json({}));
		expect(await getEventTypes(client)).toEqual({ content: [], system: [] });
	});

	it('throws on an engine without the route, which the load turns into no list', async () => {
		const { client } = clientFor(() => json({ error: 'not found' }, 404));
		await expect(getEventTypes(client)).rejects.toThrow();
	});
});

describe('listDatasources', () => {
	it('reads the rows and whether the plugin says datasources are enabled', async () => {
		const off = await listDatasources(clientFor(() => json({ data: [], total_count: 0, limit: 0, offset: 0, enabled: false })).client);
		expect(off).toEqual({ rows: [], enabled: false });
		const on = await listDatasources(clientFor(() => json({ data: [{ id: 'd1', name: 'warehouse' }], enabled: true })).client);
		expect(on.enabled).toBe(true);
		expect(on.rows.map((d) => d.name)).toEqual(['warehouse']);
	});

	it('reads a list without the flag as enabled, enveloped or bare', async () => {
		expect((await listDatasources(clientFor(() => json({ data: [] })).client)).enabled).toBe(true);
		expect((await listDatasources(clientFor(() => json([])).client)).enabled).toBe(true);
	});
});

describe('getCatalog', () => {
	it('keeps the flag the plugin sets on each type', async () => {
		const { client } = clientFor(() => json({ data: [{ type: 'data.join', enabled: false }, { type: 'data.set', enabled: true }] }));
		const specs = await getCatalog(client);
		expect(specs.map((s) => [s.type, s.enabled])).toEqual([
			['data.join', false],
			['data.set', true],
		]);
	});

	it('reads an enveloped and a bare list alike', async () => {
		expect(await getCatalog(clientFor(() => json({ data: [] })).client)).toEqual([]);
		expect(await getCatalog(clientFor(() => json([{ type: 'data.set' }])).client)).toHaveLength(1);
	});
});

describe('refusalOf', () => {
	it('keeps the node ids a 402 body names', () => {
		const body = JSON.stringify({
			error: 'payment_required',
			feature: 'example-capability',
			errors: [
				{ node_id: 'trigger', path: '/trigger/config/path', message: 'not enabled here' },
				{ node_id: 'q', path: '/type', message: 'not enabled here' },
				{ node_id: 'q', path: '/config/datasource', message: 'not enabled here' },
			],
		});
		const refusal = refusalOf(402, body)!;
		expect(refusal).toBeInstanceOf(FlowRefusal);
		expect(refusal.status).toBe(402);
		expect(refusal.nodeIds).toEqual(['trigger', 'q']);
		expect(refusal.errors).toHaveLength(3);
		expect(refusal.limit).toBeNull();
	});

	it('reads the limit and the count of a ceiling refusal', () => {
		const refusal = refusalOf(402, JSON.stringify({ error: 'payment_required', errors: [], cap: 'example.cap', limit: 7, current: 6 }))!;
		expect(refusal.limit).toBe(7);
		expect(refusal.current).toBe(6);
		expect(refusal.nodeIds).toEqual([]);
	});

	it('answers null for any other status and an empty refusal for a body that is not JSON', () => {
		expect(refusalOf(422, '{}')).toBeNull();
		const refusal = refusalOf(402, 'nope')!;
		expect(refusal.nodeIds).toEqual([]);
		expect(refusal.limit).toBeNull();
	});
});

describe('refusalAware', () => {
	it('throws the refusal before the client reduces the body to one word, and passes everything else through', async () => {
		const fetch = refusalAware(async (url) =>
			String(url).endsWith('/refused') ? json({ error: 'payment_required', errors: [{ node_id: 'q', path: '', message: 'm' }] }, 402) : json({ ok: true })
		);
		const client = createClient(fetch, {});
		await expect(client.post('/refused', {})).rejects.toMatchObject({ status: 402, nodeIds: ['q'] });
		await expect(client.get('/answered')).resolves.toEqual({ ok: true });
	});
});
