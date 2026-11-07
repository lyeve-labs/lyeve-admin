import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

function event(reply: Response, search = '?site=s1&path=%2Fcontact&block=b1', session: string | null = 'tok') {
	const fetch = vi.fn(async () => reply);
	const url = new URL(`http://admin/admin/forms/export${search}`);
	return {
		fetch,
		ev: { fetch, url, cookies: { get: (n: string) => (n === '__Host-sys_session' && session ? session : undefined) } } as never,
	};
}

describe('form submissions export', () => {
	it('streams the engine CSV with its type and filename, sending the session as a bearer', async () => {
		const { ev, fetch } = event(
			new Response('id,state\ne1,new\n', {
				headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="form-submissions.csv"' },
			}),
		);
		const res = await GET(ev);
		const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(path).toBe('/api/admin/builder/forms/submissions/export?site=s1&path=%2Fcontact&block=b1');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
		expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
		expect(res.headers.get('content-disposition')).toBe('attachment; filename="form-submissions.csv"');
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.text()).toBe('id,state\ne1,new\n');
	});

	it('refuses a link that names no form before asking the engine', async () => {
		const { ev, fetch } = event(new Response(''), '?site=s1');
		await expect(GET(ev)).rejects.toMatchObject({ status: 400 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses without a session before asking the engine', async () => {
		const { ev, fetch } = event(new Response(''), '?site=s1&path=%2Fcontact&block=b1', null);
		await expect(GET(ev)).rejects.toMatchObject({ status: 401 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('says a refused export in its own words and keeps engine text out', async () => {
		const forbidden = event(new Response('{"error":"forbidden"}', { status: 403 }));
		await expect(GET(forbidden.ev)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only an admin or a super admin can export form submissions.' },
		});
		const down = event(new Response('pq: connection refused', { status: 503 }));
		await expect(GET(down.ev)).rejects.toMatchObject({ status: 502, body: { message: 'Could not export the submissions. Try again.' } });
	});
});
