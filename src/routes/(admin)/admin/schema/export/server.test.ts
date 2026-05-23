import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

function event(format: string | null, reply: Response, session = 'tok') {
	const fetch = vi.fn(async () => reply);
	const url = new URL(`http://admin/admin/schema/export${format ? `?format=${format}` : ''}`);
	return {
		fetch,
		ev: { fetch, url, cookies: { get: (n: string) => (n === '__Host-sys_session' ? session : undefined) } } as never,
	};
}

describe('schema export download', () => {
	it('forwards the YAML file with a filename', async () => {
		const { ev, fetch } = event(null, new Response('schemas: []', { headers: { 'content-type': 'application/yaml' } }));
		const res = await GET(ev);
		expect(res.headers.get('content-disposition')).toBe('attachment; filename="lyeve-schemas.yaml"');
		expect(await res.text()).toBe('schemas: []');
		expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('/api/admin/schemas/export');
	});

	it('asks the engine for JSON when the link does', async () => {
		const { ev, fetch } = event('json', new Response('{}', { headers: { 'content-type': 'application/json' } }));
		const res = await GET(ev);
		expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('/api/admin/schemas/export?format=json');
		expect(res.headers.get('content-disposition')).toContain('lyeve-schemas.json');
	});

	it('says a refused export in its own words', async () => {
		const { ev } = event(null, new Response('{"error":"forbidden"}', { status: 403 }));
		await expect(GET(ev)).rejects.toMatchObject({ status: 403 });
	});
});
