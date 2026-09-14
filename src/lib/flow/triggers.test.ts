import { describe, expect, it } from 'vitest';
import { defaultTriggerJSON, slugify, statusTone, triggerLabel } from './triggers';
import { fixtureCatalog } from './fixtures';

describe('defaultTriggerJSON', () => {
	it('starts a contributed trigger from its type alone', () => {
		const spec = fixtureCatalog.find((s) => s.type === 'email.bounced');
		expect(spec?.trigger).toBe(true);
		expect(JSON.parse(defaultTriggerJSON('email.bounced', { template: 'welcome' }, spec))).toEqual({ type: 'email.bounced' });
		// Without the spec the type is unknown and the sample is empty, as for any unknown type.
		expect(JSON.parse(defaultTriggerJSON('email.bounced', { template: 'welcome' }))).toEqual({});
	});

	it('gives each trigger type the keys its expressions read', () => {
		const http = JSON.parse(defaultTriggerJSON('trigger.http'));
		expect(Object.keys(http)).toEqual(['protocol', 'method', 'path', 'query', 'params', 'headers', 'body', 'ip', 'user']);
		const event = JSON.parse(defaultTriggerJSON('trigger.event'));
		expect(event).toMatchObject({ schema: 'orders', event: 'after_create', old_data: null });
		expect(JSON.parse(defaultTriggerJSON('trigger.cron'))).toHaveProperty('scheduled_at');
		expect(JSON.parse(defaultTriggerJSON('trigger.manual'))).toEqual({});
	});

	it('starts a system event from the hook name and a payload, not from a content record', () => {
		const system = JSON.parse(defaultTriggerJSON('trigger.event', { kind: 'system', name: 'flow.run_failed', schema: 'contact' }));
		expect(system).toEqual({ kind: 'system', name: 'flow.run_failed', schema: 'contact', data: {} });
		expect(JSON.parse(defaultTriggerJSON('trigger.event', { kind: 'system' }))).toEqual({ kind: 'system', name: '', data: {} });
		expect(JSON.parse(defaultTriggerJSON('trigger.event', { kind: 'content', schema: 'x' }))).toHaveProperty('record_id');
	});

	it('is an empty object for a type it does not know, pretty printed', () => {
		expect(defaultTriggerJSON('trigger.future')).toBe('{}');
		expect(defaultTriggerJSON('trigger.webhook')).toContain('\n');
	});
});

describe('triggerLabel', () => {
	it('names the known triggers and strips the prefix from the rest', () => {
		expect(triggerLabel('trigger.http')).toBe('API');
		expect(triggerLabel('trigger.cron')).toBe('Cron');
		expect(triggerLabel('trigger.future')).toBe('future');
		expect(triggerLabel('manual')).toBe('manual');
	});

	it('is empty for nothing', () => {
		expect(triggerLabel(null)).toBe('');
		expect(triggerLabel(undefined)).toBe('');
		expect(triggerLabel('')).toBe('');
	});
});

describe('statusTone', () => {
	it.each([
		['active', 'success'],
		['succeeded', 'success'],
		['running', 'brand'],
		['failed', 'danger'],
		['disabled', 'warn'],
		['canceled', 'warn'],
		['draft', 'neutral'],
		[null, 'neutral'],
		[undefined, 'neutral'],
	])('maps %s to %s', (status, tone) => {
		expect(statusTone(status)).toBe(tone);
	});
});

describe('slugify', () => {
	it('lower cases, joins with dashes and drops what the engine refuses', () => {
		expect(slugify('Orders With Shipments')).toBe('orders-with-shipments');
		expect(slugify('  Nightly  export!! ')).toBe('nightly-export');
	});

	it('starts with a letter and never ends with a dash', () => {
		expect(slugify('2026 report')).toBe('report');
		expect(slugify('report-')).toBe('report');
		expect(slugify('---')).toBe('');
	});

	it('cuts at forty characters', () => {
		expect(slugify('a'.repeat(50))).toHaveLength(40);
	});
});
