import { describe, expect, it } from 'vitest';
import { FlowRefusal } from '$lib/api/flows';
import { refusalFailure } from './flow-refusal';

type Failure = { status: number; data: { error: string; refusal?: unknown; locked?: boolean; errors?: unknown[] } };

describe('refusalFailure', () => {
	it('quotes the limit and the count of a ceiling refusal as the plugin sent them', () => {
		const result = refusalFailure(new FlowRefusal([], 7, 7)) as unknown as Failure;
		expect(result.status).toBe(402);
		expect(result.data.refusal).toEqual({ nodeIds: [], limit: 7, current: 7 });
		expect(result.data.error).toBe('7 of 7 flows are in use, the most this instance keeps. Delete one to make room for another.');
	});

	it('quotes the limit alone when the refusal carries no count', () => {
		const result = refusalFailure(new FlowRefusal([], 12)) as unknown as Failure;
		expect(result.data.error).toBe('This instance keeps at most 12 flows. Delete one to make room for another.');
	});

	it('lists the nodes a definition refusal names and keeps their problems', () => {
		const errors = [
			{ node_id: 'trigger', path: '/config/path', message: 'not enabled here' },
			{ node_id: 'rows', path: '/type', message: 'not enabled here' },
		];
		const result = refusalFailure(new FlowRefusal(errors)) as unknown as Failure;
		expect(result.data.refusal).toEqual({ nodeIds: ['trigger', 'rows'], limit: null, current: null });
		expect(result.data.error).toBe('2 elements use what this instance does not enable: the trigger, rows.');
		expect(result.data.errors).toEqual(errors);
	});

	it('locks the page for a refusal that names no node and no limit', () => {
		const result = refusalFailure(new FlowRefusal([])) as unknown as Failure;
		expect(result.data.locked).toBe(true);
		expect(result.data.refusal).toBeUndefined();
	});
});
