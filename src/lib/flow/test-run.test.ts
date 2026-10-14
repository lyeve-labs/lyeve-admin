import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { FlowRefusal } from '$lib/api/flows';
import { BLOCKED_MESSAGE } from './blocked';
import { parseTrigger, sampleKey, testFailure, untilOptions } from './test-run';

describe('sampleKey', () => {
	it('follows the type and the kind, and a system event by its name and scope', () => {
		expect(sampleKey({ type: 'trigger.http', config: { path: '/a' } })).toBe('trigger.http:');
		expect(sampleKey({ type: 'trigger.event', config: { kind: 'content' } })).toBe('trigger.event:content');
		expect(sampleKey({ type: 'trigger.event', config: { kind: 'system', name: 'user.created', schema: 'x' } })).toBe('trigger.event:system:user.created:x');
	});
});

describe('untilOptions', () => {
	it('offers the whole run first, then each node by name and id', () => {
		expect(untilOptions([{ id: 'a', type: 'x', name: 'Load', config: {} }, { id: 'b', type: 'x', config: {} }] as never)).toEqual([
			{ value: '', label: 'Run to the end' },
			{ value: 'a', label: 'Load (a)' },
			{ value: 'b', label: 'b' },
		]);
	});
});

describe('parseTrigger', () => {
	it('reads an empty field as an empty object and refuses text that is not JSON', () => {
		expect(parseTrigger('  ')).toEqual({ ok: true, value: {} });
		expect(parseTrigger('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
		expect(parseTrigger('{a')).toEqual({ ok: false, error: 'The trigger is not valid JSON.' });
	});
});

describe('testFailure', () => {
	it('names the nodes a 402 refused', () => {
		const out = testFailure(new FlowRefusal([{ node_id: 'orders', path: '/type', message: 'x' }]));
		expect(out).toMatchObject({ kind: 'refused', text: 'One element uses what this instance does not enable: orders.' });
	});

	it('reads the blocked message as the blocked state and a 422 list as problems', () => {
		expect(testFailure(new ApiError(422, BLOCKED_MESSAGE))).toEqual({ kind: 'blocked' });
		const list = JSON.stringify({ ok: false, errors: [{ node_id: 'join', path: '/config', message: 'required' }] });
		expect(testFailure(new ApiError(422, list))).toMatchObject({ kind: 'refused', text: 'The definition did not validate.', errors: [{ node_id: 'join' }] });
	});

	it('says the run failed when the error says nothing', () => {
		expect(testFailure(new Error(''))).toEqual({ kind: 'refused', errors: [], text: 'The test run failed.' });
	});
});
