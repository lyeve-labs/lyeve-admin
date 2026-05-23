import { describe, it, expect, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { ACCENT_MIN_CONTRAST, accentShades, accentStyle, contrastRatio, editablePage, getCustomization, isExternal, parseAccent, slugify, visibleTo, type CustomPage } from './customization';

describe('customization helpers', () => {
	it('makes a slug from a title', () => {
		expect(slugify('Launch checklist, Q4!')).toBe('launch-checklist-q4');
		expect(slugify('  Café  ')).toBe('cafe');
	});

	it('reads an accent or says why not', () => {
		expect(parseAccent('')).toBe('');
		expect(parseAccent(' #0A7CFF ')).toBe('#0a7cff');
		expect(parseAccent('blue')).toBeNull();
		expect(parseAccent('#fff')).toBeNull();
	});

	it('measures contrast the WCAG way', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
		expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
	});

	it('keeps a color that already reads on the theme', () => {
		const light = accentShades('#005a77', 'light');
		expect(light.base).toBe('#005a77');
		expect(light.adjusted).toBe(false);
		const dark = accentShades('#00D4FF', 'dark');
		expect(dark.base).toBe('#00d4ff');
		expect(dark.adjusted).toBe(false);
	});

	it('darkens a pale accent for the light theme and lightens a deep one for the dark', () => {
		const pale = accentShades('#ffe066', 'light');
		expect(pale.adjusted).toBe(true);
		expect(pale.contrast).toBeGreaterThanOrEqual(ACCENT_MIN_CONTRAST);
		expect(contrastRatio(pale.base, '#e6e8ee')).toBeGreaterThanOrEqual(ACCENT_MIN_CONTRAST);
		const deep = accentShades('#1a0f5c', 'dark');
		expect(deep.adjusted).toBe(true);
		expect(contrastRatio(deep.base, '#162233')).toBeGreaterThanOrEqual(ACCENT_MIN_CONTRAST);
	});

	it('clears the floor on both themes for any hue', () => {
		for (const hex of ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#7f7f7f', '#8a2be2']) {
			expect(accentShades(hex, 'light').contrast).toBeGreaterThanOrEqual(ACCENT_MIN_CONTRAST);
			expect(accentShades(hex, 'dark').contrast).toBeGreaterThanOrEqual(ACCENT_MIN_CONTRAST);
		}
	});

	it('orders the companions the way the kit does per theme', () => {
		const lum = (h: string) => contrastRatio(h, '#000000');
		const light = accentShades('#0a7cff', 'light');
		expect(lum(light.light)).toBeLessThan(lum(light.base));
		expect(lum(light.deep)).toBeLessThan(lum(light.light));
		const dark = accentShades('#0a7cff', 'dark');
		expect(lum(dark.light)).toBeGreaterThan(lum(dark.base));
		expect(lum(dark.deep)).toBeLessThan(lum(dark.base));
	});

	it('writes both ramps for the stylesheet to choose from', () => {
		const style = accentStyle('#ffe066');
		expect(style).toContain('--tenant-brand-on-dark: #ffe066');
		expect(style).toContain(`--tenant-brand-on-light: ${accentShades('#ffe066', 'light').base}`);
		expect(style).toContain('--tenant-brand-deep-on-light:');
	});

	it('limits by role, with super_admin seeing everything', () => {
		expect(visibleTo([], ['viewer'])).toBe(true);
		expect(visibleTo(['admin'], ['editor'])).toBe(false);
		expect(visibleTo(['admin', 'editor'], ['editor'])).toBe(true);
		expect(visibleTo(['admin'], ['super_admin'])).toBe(true);
	});

	it('treats anything but an admin path as leaving the admin', () => {
		expect(isExternal('/admin/media')).toBe(false);
		expect(isExternal('https://status.example.com')).toBe(true);
	});

	it('fills what the engine left out', async () => {
		const get = vi.fn().mockResolvedValue({ entitled: true, settings: { brand: { name: 'Acme' } } });
		const got = await getCustomization({ get } as unknown as HttpClient);
		expect(got.settings.brand).toEqual({ name: 'Acme', logo_url: '', accent: '', welcome: '', favicon_url: '' });
		expect(got.settings.menu).toEqual({ hidden: [], pinned: [], links: [] });
		expect(got.pages).toEqual([]);
	});

	it('fills every field an editor binds, whatever the engine left out', () => {
		const stored = {
			slug: 'launch',
			title: 'Launch',
			description: '',
			roles: [],
			position: 0,
			blocks: [
				{ type: 'callout', body: 'Freeze' },
				{ type: 'content', schema: 'articles', limit: 5 },
				{ type: 'stats' },
				{ type: 'links', links: [{ label: 'Docs', url: 'https://docs.example.com' }] },
				{ type: 'markdown', body: 'Hi' },
			],
		} as unknown as CustomPage;
		const page = editablePage(stored);
		for (const b of page.blocks) expect(b.title).toBe('');
		expect(page.blocks[0]).toMatchObject({ tone: 'brand', body: 'Freeze' });
		expect(page.blocks[1]).toMatchObject({ status: '', schema: 'articles', limit: 5 });
		expect(page.blocks[2].schemas).toEqual([]);
		page.blocks[3].links![0].label = 'Changed';
		expect(stored.blocks[3].links![0].label).toBe('Docs');
	});
});
