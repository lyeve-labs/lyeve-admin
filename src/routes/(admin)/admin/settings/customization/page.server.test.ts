import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
	getCustomization: vi.fn(),
	saveCustomization: vi.fn(),
	saveCustomPage: vi.fn(),
	deleteCustomPage: vi.fn(),
}));

const client = vi.hoisted(() => ({ delete: vi.fn(async () => undefined) }));
const media = vi.hoisted(() => ({ importMedia: vi.fn() }));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => client),
	authedHeaders: vi.fn(() => ({ Authorization: 'Bearer tok', 'X-CSRF-Token': 'c' })),
	requireRole: vi.fn(async () => ({ roles: ['admin'] })),
}));
vi.mock('$lib/api/media', async (orig) => ({
	...(await orig<typeof import('$lib/api/media')>()),
	listMediaChoices: vi.fn(async () => []),
	importMedia: media.importMedia,
}));
vi.mock('$lib/api/custom-dashboard', () => ({
	getDashboardLayout: vi.fn(async () => ({ entitled: true, custom: false, widgets: [], updated_at: null })),
}));
vi.mock('$lib/api/customization', async (orig) => ({
	...(await orig<typeof import('$lib/api/customization')>()),
	...api,
}));

import { actions, load } from './+page.server';

const settings = () => ({
	brand: { name: 'Old', logo_url: '', accent: '', welcome: '' },
	menu: { hidden: ['search'], pinned: [], links: [{ label: 'Wiki', url: 'https://wiki.example.com' }] },
	home_page: '',
});

function event(form: Record<string, string | string[]>, running = true) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(form)) for (const x of [v].flat()) fd.append(k, x);
	return {
		request: new Request('http://localhost', { method: 'POST', body: fd }),
		params: {},
		parent: async () => ({
			user: { roles: ['admin'] },
			plugins: { state: 'named', running: running ? ['multitenant'] : [], withheld: [] },
		}),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	api.getCustomization.mockResolvedValue({ entitled: true, settings: settings(), pages: [] });
	api.saveCustomization.mockImplementation(async (_c: unknown, s: unknown) => s);
});

describe('customization settings', () => {
	it('asks nothing while the multitenant plugin does not run', async () => {
		const data = (await load(event({}, false))) as { entitled: boolean };
		expect(data.entitled).toBe(false);
		expect(api.getCustomization).not.toHaveBeenCalled();
	});

	it('shows the not-enabled state when the plugin says this tenant may not shape its admin', async () => {
		api.getCustomization.mockResolvedValue({ entitled: false, settings: settings(), pages: [] });
		const data = (await load(event({}))) as { entitled: boolean; navChoices: unknown[]; mediaChoices: unknown[] };
		expect(data.entitled).toBe(false);
		expect(data.navChoices).toEqual([]);
		expect(data.mediaChoices).toEqual([]);
	});

	it('offers the menu entries of the plugins that run', async () => {
		const data = (await load(event({}))) as { entitled: boolean; navChoices: { id: string }[] };
		expect(data.entitled).toBe(true);
		const ids = data.navChoices.map((c) => c.id);
		expect(ids).toContain('tenant-costs');
		expect(ids).not.toContain('search');
	});

	it('saves the brand and keeps the menu and logo it did not touch', async () => {
		api.getCustomization.mockResolvedValue({
			entitled: true,
			settings: { ...settings(), brand: { name: 'Old', logo_url: '/api/v1/media/1/logo.png', accent: '', welcome: '' } },
			pages: [],
		});
		const res = await actions.brand(event({ name: 'Acme', logo_url: 'https://ignored.example.com', accent: '#0A7CFF', welcome: 'Hi' }));
		expect(res).toEqual({ brandSaved: true });
		const saved = api.saveCustomization.mock.calls[0][1];
		expect(saved.brand).toEqual({ name: 'Acme', logo_url: '/api/v1/media/1/logo.png', accent: '#0a7cff', welcome: 'Hi' });
		expect(saved.menu.links).toHaveLength(1);
	});

	it('imports a logo on another site into the library, removes it when empty, and refuses anything else', async () => {
		media.importMedia.mockResolvedValueOnce({ id: 'm1', content_type: 'image/png', public_url: '/api/v1/media/m1/logo.png' });
		expect(await actions.logo(event({ logo_url: 'https://images.example.com/logo.png' }))).toEqual({ logoSaved: true, logoImported: true });
		expect(media.importMedia).toHaveBeenCalledWith(client, expect.objectContaining({ url: 'https://images.example.com/logo.png', public: true, max_bytes: 500_000 }));
		expect(api.saveCustomization.mock.calls[0][1].brand.logo_url).toBe('/api/v1/media/m1/logo.png');
		expect(await actions.logo(event({ logo_url: '' }))).toEqual({ logoRemoved: true });
		expect(api.saveCustomization.mock.calls[1][1].brand.logo_url).toBe('');
		const refused = (await actions.logo(event({ logo_url: 'javascript:alert(1)' }))) as { status: number };
		expect(refused.status).toBe(400);
		expect(api.saveCustomization).toHaveBeenCalledTimes(2);
	});

	it('keeps a library address as it is, without importing it', async () => {
		expect(await actions.logo(event({ logo_url: '/api/v1/media/m2/mark.webp' }))).toEqual({ logoSaved: true });
		expect(media.importMedia).not.toHaveBeenCalled();
	});

	it('refuses an imported file that is not an image a logo can be, and removes it', async () => {
		media.importMedia.mockResolvedValueOnce({ id: 'm3', content_type: 'application/pdf', public_url: '/api/v1/media/m3/doc.pdf' });
		const res = (await actions.logo(event({ logo_url: 'https://example.com/doc.pdf' }))) as { status: number; data: { logoError: string } };
		expect(res.status).toBe(400);
		expect(res.data.logoError).toContain('PNG, JPEG or WebP');
		expect(client.delete).toHaveBeenCalledWith('/api/admin/media/m3');
		expect(api.saveCustomization).not.toHaveBeenCalled();
	});

	it('says why when the engine refuses the address', async () => {
		media.importMedia.mockRejectedValueOnce(Object.assign(new Error('that address is private or not allowed'), { status: 422 }));
		const res = (await actions.logo(event({ logo_url: 'https://10.0.0.5/logo.png' }))) as { status: number };
		expect(res.status).toBe(400);
		expect(api.saveCustomization).not.toHaveBeenCalled();
	});

	it('refuses an accent that is not a color', async () => {
		const res = (await actions.brand(event({ name: 'Acme', accent: 'blue' }))) as { status: number };
		expect(res.status).toBe(400);
		expect(api.saveCustomization).not.toHaveBeenCalled();
	});

	it('never pins what it hides', async () => {
		await actions.menu(event({ hidden: ['media'], pinned: ['media', 'flows'] }));
		const saved = api.saveCustomization.mock.calls[0][1];
		expect(saved.menu).toMatchObject({ hidden: ['media'], pinned: ['flows'] });
	});

	it('refuses a link that is neither https nor an admin path', async () => {
		const res = (await actions.addLink(event({ label: 'X', url: 'javascript:alert(1)' }))) as { status: number };
		expect(res.status).toBe(400);
	});

	it('creates a page from its title and opens its editor', async () => {
		await expect(actions.createPage(event({ title: 'Launch checklist', slug: '' }))).rejects.toMatchObject({
			status: 303,
			location: '/admin/settings/customization/pages/launch-checklist',
		});
		expect(api.saveCustomPage.mock.calls[0][1]).toMatchObject({ slug: 'launch-checklist', title: 'Launch checklist', blocks: [] });
	});
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

/** An upload post, with an engine that answers the media calls. */
function uploadEvent(file: File, media: { upload?: Response; publish?: Response } = {}, field = 'logo') {
	const fd = new FormData();
	fd.append(field, file);
	const calls: { url: string; method?: string; body?: unknown }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), method: init?.method, body: init?.body });
		if (init?.method === 'POST') return media.upload ?? Response.json([{ id: 'm1', filename: 'logo.png' }], { status: 201 });
		return media.publish ?? Response.json({ id: 'm1', public: true, public_url: '/api/v1/media/m1/logo.png' });
	});
	return {
		calls,
		ev: {
			request: new Request('http://localhost', { method: 'POST', body: fd }),
			fetch,
			cookies: { get: (n: string) => (n === '__Host-sys_session' ? 'tok' : n === '__Host-csrf' ? 'c' : undefined) },
			params: {},
		} as never,
	};
}

describe('logo upload', () => {
	it('stores the file in the media library, publishes it and makes it the logo', async () => {
		const { ev, calls } = uploadEvent(new File([PNG], 'logo.png', { type: 'image/png' }));
		expect(await actions.uploadLogo(ev)).toEqual({ logoSaved: true, logoUploaded: true });
		expect(calls.map((c) => [c.method, c.url])).toEqual([
			['POST', '/api/admin/media'],
			['PATCH', '/api/admin/media/m1'],
		]);
		expect(calls[1].body).toBe(JSON.stringify({ public: true }));
		expect(api.saveCustomization.mock.calls[0][1].brand.logo_url).toBe('/api/v1/media/m1/logo.png');
	});

	it('refuses a file whose bytes are not the image it claims, before the engine sees it', async () => {
		const { ev, calls } = uploadEvent(new File(['<svg onload=alert(1)>'], 'logo.png', { type: 'image/png' }));
		const res = (await actions.uploadLogo(ev)) as { status: number; data: { logoError: string } };
		expect(res.status).toBe(400);
		expect(res.data.logoError).toMatch(/not the image/);
		expect(calls).toHaveLength(0);
	});

	it('refuses SVG and oversized files', async () => {
		const svg = uploadEvent(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
		expect(((await actions.uploadLogo(svg.ev)) as { data: { logoError: string } }).data.logoError).toMatch(/PNG, JPEG or WebP/);
		const big = uploadEvent(new File([PNG, new Uint8Array(600_000)], 'logo.png', { type: 'image/png' }));
		expect(((await actions.uploadLogo(big.ev)) as { data: { logoError: string } }).data.logoError).toMatch(/500 KB/);
		expect(svg.calls.length + big.calls.length).toBe(0);
	});

	it("relays the library's own refusal and hides anything else", async () => {
		const refused = uploadEvent(new File([PNG], 'logo.png', { type: 'image/png' }), {
			upload: Response.json({ error: 'file type not allowed' }, { status: 422 }),
		});
		expect(((await actions.uploadLogo(refused.ev)) as { data: { logoError: string } }).data.logoError).toBe('file type not allowed');
		const broken = uploadEvent(new File([PNG], 'logo.png', { type: 'image/png' }), {
			upload: Response.json({ error: 'pq: boom' }, { status: 503 }),
		});
		expect(((await actions.uploadLogo(broken.ev)) as { data: { logoError: string } }).data.logoError).toBe('The logo could not be uploaded.');
		expect(api.saveCustomization).not.toHaveBeenCalled();
	});

	it('says the file is in the library when it could not be published there', async () => {
		const { ev } = uploadEvent(new File([PNG], 'logo.png', { type: 'image/png' }), { publish: new Response('', { status: 503 }) });
		const res = (await actions.uploadLogo(ev)) as { data: { logoError: string } };
		expect(res.data.logoError).toMatch(/uploaded to the media library but could not be published/);
		expect(api.saveCustomization).not.toHaveBeenCalled();
	});
});

// The tab icon takes the logo's path into the library and is stored beside
// it, so saving one never touches the other.
describe('tab icon', () => {
	it('stores an address as the favicon and keeps the logo', async () => {
		api.getCustomization.mockResolvedValue({
			entitled: true,
			settings: { ...settings(), brand: { ...settings().brand, logo_url: '/api/v1/media/1/logo.png' } },
			pages: [],
		});
		expect(await actions.favicon(event({ favicon_url: '/api/v1/media/m2/icon.png' }))).toEqual({ faviconSaved: true });
		const saved = api.saveCustomization.mock.calls[0][1].brand;
		expect(saved.favicon_url).toBe('/api/v1/media/m2/icon.png');
		expect(saved.logo_url).toBe('/api/v1/media/1/logo.png');
		expect(await actions.favicon(event({ favicon_url: '' }))).toEqual({ faviconRemoved: true });
	});

	it('imports an icon on another site and refuses an unsafe address', async () => {
		media.importMedia.mockResolvedValueOnce({ id: 'm3', content_type: 'image/png', public_url: '/api/v1/media/m3/icon.png' });
		expect(await actions.favicon(event({ favicon_url: 'https://images.example.com/icon.png' }))).toEqual({ faviconSaved: true, faviconImported: true });
		const refused = (await actions.favicon(event({ favicon_url: 'javascript:alert(1)' }))) as { status: number; data: { faviconError: string; fields: Record<string, string> } };
		expect(refused.status).toBe(400);
		expect(refused.data.faviconError).toMatch(/tab icon address/);
		expect(refused.data.fields.favicon_url).toBeTruthy();
	});

	it('uploads a file, publishes it and makes it the icon', async () => {
		const { ev, calls } = uploadEvent(new File([PNG], 'icon.png', { type: 'image/png' }), {}, 'favicon');
		expect(await actions.uploadFavicon(ev)).toEqual({ faviconSaved: true, faviconUploaded: true });
		expect(calls.map((c) => c.method)).toEqual(['POST', 'PATCH']);
		expect(api.saveCustomization.mock.calls[0][1].brand.favicon_url).toBe('/api/v1/media/m1/logo.png');
	});

	it('refuses a file that is not an image the icon can be', async () => {
		const svg = uploadEvent(new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' }), {}, 'favicon');
		const res = (await actions.uploadFavicon(svg.ev)) as { status: number; data: { faviconError: string } };
		expect(res.status).toBe(400);
		expect(res.data.faviconError).toBe('A tab icon is a PNG, JPEG or WebP image.');
	});
});
