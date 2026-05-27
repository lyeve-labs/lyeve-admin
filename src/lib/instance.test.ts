import { describe, expect, it } from 'vitest';
import { instanceFrom } from './instance.svelte';
import { licensingOf, NO_LICENSING } from './api/license';
import type { Entitlements } from './entitlements';
import type { PluginSet } from './plugins';

const base: Entitlements = { plan: 'example', state: 'active', features: [], tenant_quota: 0 };

function named(running: string[], withheld: string[] = []): PluginSet {
	return { state: 'named', running, withheld };
}

const licensing = licensingOf({
	links: [
		{ rel: 'upgrade', label: 'Turn it on', url: '/admin/settings/license' },
		{ rel: 'support', label: 'Help', url: 'https://example.test/help' },
	],
	renew: true,
});

describe('instanceFrom', () => {
	it('serves the plugins the engine names as running, and not the ones withheld from this tenant', () => {
		const instance = instanceFrom(() => ({ plugins: named(['search'], ['audit']) }));
		expect(instance.serves('search')).toBe(true);
		expect(instance.serves('audit')).toBe(false);
		expect(instance.serves('webhook')).toBe(false);
	});

	it('serves nothing when nothing could be read', () => {
		expect(instanceFrom(() => null).serves('search')).toBe(false);
		expect(instanceFrom(() => ({ plugins: { state: 'unread' } })).serves('search')).toBe(false);
	});

	it('links a license module only when the engine says so', () => {
		expect(instanceFrom(() => ({ entitlements: { ...base, license_module: true } })).licenseModule()).toBe(true);
		expect(instanceFrom(() => ({ entitlements: { ...base, license_module: false } })).licenseModule()).toBe(false);
		expect(instanceFrom(() => ({ entitlements: base })).licenseModule()).toBe(false);
		expect(instanceFrom(() => null).licenseModule()).toBe(false);
	});

	it('points a feature it does not serve at the link the engine sent, in the module\'s words', () => {
		const instance = instanceFrom(() => ({ licensing }));
		expect(instance.upgradeLink('/admin/settings/license?plugin=search')).toEqual({
			href: '/admin/settings/license?plugin=search',
			label: 'Turn it on',
		});
	});

	it('falls back to the module\'s upgrade link when the engine sent none, or an unsafe one', () => {
		const instance = instanceFrom(() => ({ licensing }));
		const own = { href: '/admin/settings/license', label: 'Turn it on' };
		expect(instance.upgradeLink()).toEqual(own);
		expect(instance.upgradeLink('')).toEqual(own);
		expect(instance.upgradeLink('javascript:alert(1)')).toEqual(own);
	});

	it('keeps the engine\'s link without words when no module serves any', () => {
		const instance = instanceFrom(() => ({ licensing: NO_LICENSING }));
		expect(instance.upgradeLink('https://example.test/enable')).toEqual({ href: 'https://example.test/enable' });
		expect(instance.upgradeLink()).toBeNull();
		expect(instance.upgradeLink('javascript:alert(1)')).toBeNull();
	});

	it('offers support only where the module serves it, in its words', () => {
		expect(instanceFrom(() => ({ licensing })).supportLink()).toEqual({ href: 'https://example.test/help', label: 'Help' });
		expect(instanceFrom(() => ({ licensing: NO_LICENSING })).supportLink()).toBeNull();
		expect(instanceFrom(() => null).supportLink()).toBeNull();
	});

	it('reads the layout again on every call, so a new load is seen', () => {
		let plugins = named([]);
		const instance = instanceFrom(() => ({ plugins }));
		expect(instance.serves('webhook')).toBe(false);
		plugins = named(['webhook']);
		expect(instance.serves('webhook')).toBe(true);
	});
});
