import { describe, expect, it, vi } from 'vitest';
import { appName, brandOf, documentTitle, PRODUCT_NAME, readPublicBrand, STOCK_BRAND } from './brand';

describe('brandOf', () => {
	it('keeps a brand the admin can draw', () => {
		const raw = { name: ' Acme ', logo_url: '/api/v1/media/1/logo.png', accent: '#0A7CFF', favicon_url: '/api/v1/media/2/i.png' };
		expect(brandOf(raw)).toEqual({ name: 'Acme', logo_url: '/api/v1/media/1/logo.png', accent: '#0a7cff', favicon_url: '/api/v1/media/2/i.png' });
	});

	it('reads anything it could not draw safely as unset', () => {
		const raw = { name: 7 as never, logo_url: 'javascript:alert(1)', accent: 'red', favicon_url: 'http://example.com/i.png' };
		expect(brandOf(raw)).toEqual(STOCK_BRAND);
		expect(brandOf(null)).toEqual(STOCK_BRAND);
	});

	// The admin imports an image on another site before storing it, so only a
	// direct write to the engine leaves one there, and the image policy would
	// block it. A path that climbs out of the library reaches other routes.
	it('draws only images from the media library', () => {
		expect(brandOf({ logo_url: 'https://images.example.com/l.png', favicon_url: '/api/v1/media/../../admin/x' })).toEqual(STOCK_BRAND);
	});
});

describe('titles', () => {
	it('end in the product name until the tenant names the admin', () => {
		expect(appName(null)).toBe(PRODUCT_NAME);
		expect(documentTitle(STOCK_BRAND, 'Sign in')).toBe('Sign in - LyEve Admin');
		expect(documentTitle({ ...STOCK_BRAND, name: 'Acme Studio' }, 'Sign in')).toBe('Sign in - Acme Studio');
		expect(documentTitle({ ...STOCK_BRAND, name: 'Acme Studio' })).toBe('Acme Studio');
		expect(documentTitle(undefined, '', 'Plugins')).toBe('Plugins - LyEve Admin');
	});
});

describe('readPublicBrand', () => {
	it('reads the public route', async () => {
		const fetch = vi.fn().mockResolvedValue(Response.json({ name: 'Acme', logo_url: '', accent: '', favicon_url: '' }));
		expect(await readPublicBrand(fetch)).toEqual({ ...STOCK_BRAND, name: 'Acme' });
		expect(fetch).toHaveBeenCalledWith('/api/admin/auth/brand', expect.objectContaining({ signal: expect.any(AbortSignal) }));
	});

	// An engine without the plugin answers 404, and one that is down throws.
	// Either way somebody has to be able to sign in.
	it('falls back to the stock brand when the engine does not answer one', async () => {
		expect(await readPublicBrand(vi.fn().mockResolvedValue(new Response('', { status: 404 })))).toEqual(STOCK_BRAND);
		expect(await readPublicBrand(vi.fn().mockRejectedValue(new Error('down')))).toEqual(STOCK_BRAND);
	});
});
