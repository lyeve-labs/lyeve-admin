import { describe, expect, it, vi } from 'vitest';
import { load } from './+layout.server';

function event(routeId: string | null, fetch = vi.fn().mockResolvedValue(Response.json({ name: 'Acme', logo_url: '', accent: '', favicon_url: '' }))) {
	return { route: { id: routeId }, fetch } as never;
}

describe('root layout', () => {
	it('reads the public brand for a page outside the admin frame', async () => {
		const fetch = vi.fn().mockResolvedValue(Response.json({ name: 'Acme', logo_url: '/api/v1/media/1/l.png', accent: '', favicon_url: '' }));
		const out = (await load(event('/login', fetch))) as { brand: { name: string; logo_url: string } };
		expect(out.brand.name).toBe('Acme');
		expect(out.brand.logo_url).toBe('/api/v1/media/1/l.png');
		expect(fetch).toHaveBeenCalledWith('/api/admin/auth/brand', expect.anything());
	});

	it('leaves the admin frame to its own copy and asks nothing', async () => {
		const fetch = vi.fn();
		expect(await load(event('/(admin)/admin/settings', fetch))).toEqual({ brand: null });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('brands a page no route matched', async () => {
		const out = (await load(event(null))) as { brand: { name: string } };
		expect(out.brand.name).toBe('Acme');
	});
});
