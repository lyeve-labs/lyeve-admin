import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import type { PluginStatus, PluginStatusReport } from '@lyeve-labs/client-rest';
import {
	notRunning,
	pluginSetOf,
	readPluginSet,
	runs,
	UNNAMED,
	UNREAD,
	whyNotRunning,
	withheldFrom,
	type PluginSet,
} from './plugins';

const named = (running: string[], withheld: string[] = []): PluginSet => ({ state: 'named', running, withheld });

function row(name: string, over: Partial<PluginStatus> = {}): PluginStatus {
	return { name, compiled: true, entitled: true, requested: true, active: true, phase: 'running', ...over };
}

function report(...rows: PluginStatus[]): PluginStatusReport {
	return { compiled: rows.map((r) => r.name), entitled: [], plugins: rows };
}

describe('runs', () => {
	it('answers from the names the engine gave', () => {
		expect(runs(named(['media']), 'media')).toBe(true);
		expect(runs(named(['media']), 'search')).toBe(false);
	});

	it('offers nothing from a set that could not be read', () => {
		expect(runs(UNREAD, 'media')).toBe(false);
	});

	it('offers everything on an engine that does not name its plugins, and without a set', () => {
		expect(runs(UNNAMED, 'media')).toBe(true);
		expect(runs(undefined, 'media')).toBe(true);
	});
});

describe('notRunning', () => {
	it('is true only when the engine named the set and the plugin is not in it', () => {
		expect(notRunning(named([]), 'media')).toBe(true);
		expect(notRunning(named(['media']), 'media')).toBe(false);
		expect(notRunning(named([], ['media']), 'media')).toBe(true);
	});

	it('says nothing when the set is unknown, so the page renders and reports its own reads', () => {
		expect(notRunning(UNREAD, 'media')).toBe(false);
		expect(notRunning(UNNAMED, 'media')).toBe(false);
		expect(notRunning(null, 'media')).toBe(false);
	});
});

describe('withheldFrom', () => {
	it('names a plugin that runs and is withheld from this tenant', () => {
		expect(withheldFrom(named([], ['media']), 'media')).toBe(true);
		expect(withheldFrom(named(['media']), 'media')).toBe(false);
		expect(withheldFrom(UNREAD, 'media')).toBe(false);
	});
});

describe('pluginSetOf', () => {
	it('takes the running list when the engine served it', () => {
		const set = pluginSetOf({ running: { plugins: ['media'], withheld: ['audit'] }, status: null, operator: false, withheld: [] });
		expect(set).toEqual(named(['media'], ['audit']));
	});

	it('reads a failed read as unread, never as an engine that runs nothing', () => {
		expect(pluginSetOf({ running: 'failed', status: report(row('media')), operator: true, withheld: [] })).toEqual(UNREAD);
	});

	it('derives the set from the status report on an engine without the list', () => {
		const status = report(
			row('media'),
			// The engine sends lazy for a plugin that starts on first use, and the
			// published client type does not list it.
			row('search', { phase: 'lazy' as PluginStatus['phase'] }),
			row('audit'),
			row('saml', { entitled: false, active: false, phase: 'registered' }),
			row('scim', { phase: 'failed', active: false }),
			row('grpc', { compiled: false }),
		);
		const set = pluginSetOf({ running: 'missing', status, operator: true, withheld: ['audit'] });
		expect(set).toEqual(named(['media', 'search'], ['audit']));
	});

	it('shows every page to a role without the status report on an engine without the list', () => {
		expect(pluginSetOf({ running: 'missing', status: null, operator: false, withheld: [] })).toEqual(UNNAMED);
	});

	it('reads an operator whose status report also failed as unread', () => {
		expect(pluginSetOf({ running: 'missing', status: null, operator: true, withheld: [] })).toEqual(UNREAD);
	});
});

describe('readPluginSet', () => {
	it('reads the running list for an action, which has no layout to ask', async () => {
		const client = { get: vi.fn(async () => ({ plugins: ['media'], withheld: [] })) } as unknown as HttpClient;
		expect(await readPluginSet(client)).toEqual(named(['media']));
	});
});

describe('whyNotRunning', () => {
	it('says a withheld plugin is withheld, to every reader', () => {
		expect(whyNotRunning('media', named([], ['media']), null)).toEqual({ state: 'withheld' });
		expect(whyNotRunning('media', named([], ['media']), report(row('media')))).toEqual({ state: 'withheld' });
	});

	it('gives a reader without the status report no reason', () => {
		expect(whyNotRunning('search', named([]), null)).toEqual({ state: 'unexplained' });
	});

	it('names a plugin that is not in this build', () => {
		expect(whyNotRunning('search', named([]), report())).toEqual({ state: 'not-built' });
		expect(whyNotRunning('search', named([]), report(row('search', { compiled: false })))).toEqual({ state: 'not-built' });
	});

	it('carries the error of a plugin that failed to start', () => {
		const failed = report(row('search', { phase: 'failed', active: false, last_error: 'index missing' }));
		expect(whyNotRunning('search', named([]), failed)).toEqual({ state: 'failed', error: 'index missing' });
	});

	it('carries the link of a plugin that is not enabled, when the engine names one', () => {
		const locked = report(row('search', { entitled: false, active: false, phase: 'registered', upgrade_url: '/admin/settings/license' }));
		expect(whyNotRunning('search', named([]), locked)).toEqual({ state: 'not-enabled', upgradeUrl: '/admin/settings/license' });
		const bare = report(row('search', { entitled: false, active: false, phase: 'registered' }));
		expect(whyNotRunning('search', named([]), bare)).toEqual({ state: 'not-enabled', upgradeUrl: '' });
	});

	it('carries the reason the engine did not start an enabled plugin', () => {
		const idle = report(row('search', { active: false, phase: 'registered', requested: false, reason: 'not requested' }));
		expect(whyNotRunning('search', named([]), idle)).toEqual({ state: 'not-started', reason: 'not requested' });
	});

	it('gives no reason when the report says the plugin runs, which a reload settles', () => {
		expect(whyNotRunning('search', named([]), report(row('search')))).toEqual({ state: 'unexplained' });
	});
});
