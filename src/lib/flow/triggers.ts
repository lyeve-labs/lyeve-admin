/**
 * What a test run's trigger payload looks like for each trigger type, and the
 * words the list page uses for one. The shapes follow the expression
 * environment: `trigger` carries these keys when the flow runs for real, so
 * a test that starts from them exercises the same expressions.
 */

import type { NodeSpec } from './types';

const TRIGGER_DEFAULTS: Record<string, unknown> = {
	'trigger.http': {
		protocol: 'rest',
		method: 'GET',
		path: '/',
		query: {},
		params: {},
		headers: {},
		body: null,
		ip: '127.0.0.1',
		user: { id: 'test-user', roles: ['admin'] },
	},
	'trigger.webhook': { headers: {}, body: {} },
	'trigger.cron': { scheduled_at: '2026-01-01T02:00:00Z' },
	'trigger.event': {
		kind: 'content',
		schema: 'orders',
		event: 'after_create',
		record_id: 'rec_1',
		data: {},
		old_data: null,
	},
	'trigger.manual': {},
};

/**
 * The trigger JSON a test starts from, pretty printed for the editor. An
 * event trigger subscribed to a system hook starts from that hook's shape,
 * the name and a payload, rather than from a content record. A trigger a
 * plugin contributes starts from its type alone: the engine spreads the
 * plugin's payload at the top level beside `type`, and the catalog carries
 * no sample of those keys, so they are what the reader adds.
 */
export function defaultTriggerJSON(type: string, config: Record<string, unknown> = {}, spec?: NodeSpec): string {
	if (spec?.plugin) {
		return JSON.stringify({ type }, null, 2);
	}
	if (type === 'trigger.event' && config.kind === 'system') {
		const scope = typeof config.schema === 'string' && config.schema ? { schema: config.schema } : {};
		return JSON.stringify({ kind: 'system', name: typeof config.name === 'string' ? config.name : '', ...scope, data: {} }, null, 2);
	}
	return JSON.stringify(TRIGGER_DEFAULTS[type] ?? {}, null, 2);
}

const TRIGGER_LABELS: Record<string, string> = {
	'trigger.http': 'API',
	'trigger.webhook': 'Webhook',
	'trigger.cron': 'Cron',
	'trigger.event': 'Event',
	'trigger.manual': 'Manual',
};

export function triggerLabel(type: string | null | undefined): string {
	if (!type) return '';
	return TRIGGER_LABELS[type] ?? type.replace(/^trigger\./, '');
}

/** The Badge tone for a flow or run status. */
export function statusTone(
	status: string | null | undefined
): 'neutral' | 'brand' | 'success' | 'warn' | 'danger' {
	switch (status) {
		case 'active':
		case 'succeeded':
			return 'success';
		case 'running':
			return 'brand';
		case 'failed':
			return 'danger';
		case 'disabled':
		case 'canceled':
		// Blocked is the engine holding a flow, not the flow failing: it
		// comes back when the plugin does, so it wears the same tone as
		// disabled and not the run-failure red.
		case 'blocked':
			return 'warn';
		default:
			return 'neutral';
	}
}

/** Slug shape the engine accepts: `[a-z][a-z0-9_-]{0,39}`. */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^[^a-z]+/, '')
		.replace(/-+$/, '')
		.slice(0, 40);
}
