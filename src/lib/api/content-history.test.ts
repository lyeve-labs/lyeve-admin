import { describe, expect, it } from 'vitest';
import { ACTIVITY_ACTIONS, actionLabel } from './content-history';

describe('activity actions', () => {
	it('offers a hard delete in the filter, under a label of its own', () => {
		expect(ACTIVITY_ACTIONS).toContain('deleted');
		expect(ACTIVITY_ACTIONS).toContain('archived');
		expect(actionLabel('deleted')).toBe('Deleted');
		expect(actionLabel('archived')).toBe('Archived');
	});

	it('gives every action the filter offers a label', () => {
		for (const action of ACTIVITY_ACTIONS) expect(actionLabel(action), action).not.toBe(action);
	});

	it('shows an action it does not know as the plugin sent it', () => {
		expect(actionLabel('imported')).toBe('imported');
	});
});
