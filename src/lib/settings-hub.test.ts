import { describe, expect, it } from 'vitest';
import type { NavTree } from '@lyeve-labs/ui-kit';
import { adminNav } from './nav';
import { HUB_IDS, settingsHub } from './settings-hub';

const SUPER = ['super_admin'];

/** Every page under /admin/settings, plus every entry filed in the Settings section. */
function settingsLeaves(tree: NavTree): string[] {
	const out = new Set<string>();
	const walk = (nodes: NavTree, inSettings: boolean) => {
		for (const n of nodes) {
			if (n.href && n.id !== 'settings' && (inSettings || n.href.startsWith('/admin/settings/'))) out.add(n.id);
			if (n.children) walk(n.children, inSettings || n.id === 'settings');
		}
	};
	walk(tree, false);
	return [...out];
}

describe('settings hub', () => {
	// A settings page with no place on the hub is reachable only from the
	// sidebar, and the two lists drift apart.
	it('places every settings page the sidebar offers a super admin', () => {
		const leaves = settingsLeaves(adminNav(SUPER));
		expect(leaves.length).toBeGreaterThan(15);
		for (const id of leaves) expect(HUB_IDS, `${id} has no group on the hub`).toContain(id);
	});

	it('shows each page once, with what it holds', () => {
		const groups = settingsHub(adminNav(SUPER), { twoFactor: true, trustedDevices: true });
		const ids = groups.flatMap((g) => g.entries.map((e) => e.id));
		expect(new Set(ids).size).toBe(ids.length);
		for (const e of groups.flatMap((g) => g.entries)) expect(e.description, e.id).not.toBe('');
	});

	it('leads with the reader\'s own pages, whatever the role', () => {
		const groups = settingsHub(adminNav(['viewer']), { twoFactor: true, trustedDevices: false });
		expect(groups[0].id).toBe('account');
		expect(groups[0].entries.map((e) => e.href)).toEqual(['/admin/settings/account', '/admin/settings/mfa']);
	});

	it('offers a reader only the instance pages their sidebar offers', () => {
		const editor = settingsHub(adminNav(['editor']), { twoFactor: true, trustedDevices: false });
		expect(editor.map((g) => g.id)).toEqual(['account', 'apis']);
		expect(editor[1].entries.map((e) => e.id)).toEqual(['api-access', 'grpc', 'graphql']);
		const admin = settingsHub(adminNav(['admin']), { twoFactor: true, trustedDevices: false });
		expect(admin.find((g) => g.id === 'workspace')?.entries.map((e) => e.id)).toEqual(['customization']);
		expect(admin.find((g) => g.id === 'instance')).toBeUndefined();
	});

	it('drops a page whose plugin does not run', () => {
		const plugins = { state: 'named' as const, running: ['multitenant', 'email'], withheld: [] };
		const hub = settingsHub(adminNav(SUPER, { plugins }), { twoFactor: true, trustedDevices: false });
		const workspace = hub.find((g) => g.id === 'workspace');
		expect(workspace?.entries.map((e) => e.id)).toEqual(['customization', 'email']);
	});

	// A beta mark belongs on the page's own header and nowhere a reader passes
	// through to get there. A mark on some entries and not on equally beta
	// ones reads as a claim about maturity the hub is not making.
	it('marks nothing as beta', () => {
		const hub = settingsHub(adminNav(SUPER), { twoFactor: true, trustedDevices: false });
		for (const group of hub) {
			for (const entry of group.entries) {
				expect(entry, entry.id).not.toHaveProperty('badge');
			}
		}
	});

	it('lists trusted devices only where the instance remembers them', () => {
		expect(settingsHub(adminNav(SUPER), { twoFactor: true, trustedDevices: true })[0].entries.map((e) => e.id)).toContain('devices');
		expect(settingsHub(adminNav(SUPER), { twoFactor: true, trustedDevices: false })[0].entries.map((e) => e.id)).not.toContain('devices');
	});

	it('lists two-factor only while the plugin behind it runs', () => {
		const own = settingsHub(adminNav(SUPER), { twoFactor: false, trustedDevices: false })[0];
		expect(own.entries.map((e) => e.id)).toEqual(['account']);
	});
});
