// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * enhance hands each form's submit function over here, so a test can run the
 * one behind a delete and apply a result to it.
 */
const forms = vi.hoisted(() => ({ submits: [] as { node: HTMLFormElement; submit: unknown }[] }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit?: unknown) => {
		forms.submits.push({ node, submit });
		return { destroy() {} };
	},
}));

import DeadLetterDrawer from './DeadLetterDrawer.svelte';

afterEach(() => {
	cleanup();
	forms.submits.length = 0;
});

const entry = (id: string, status: string) => ({
	id,
	webhook_name: 'Ship it',
	event_type: 'before_update',
	schema_name: 'post',
	total_attempts: 3,
	last_error: 'Connection refused',
	status,
	dead_at: '2026-01-02T00:00:00Z',
});

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;

describe('the dead letter drawer', () => {
	it('stays shut until the action returns the queue', () => {
		render(DeadLetterDrawer, { props: { form: null } });
		expect(dialog()).toBeNull();
	});

	it('opens on the returned queue and states the total when it is larger than the page', () => {
		render(DeadLetterDrawer, { props: { form: { deadLetters: [entry('a', 'pending'), entry('b', 'replayed')], deadLetterTotal: 9 } } });
		expect(dialog()?.textContent).toContain('Dead letter queue');
		expect(dialog()?.textContent).toContain('Showing 2 of 9 entries.');
	});

	it('leaves the total out when the queue did not state one', () => {
		render(DeadLetterDrawer, { props: { form: { deadLetters: [entry('a', 'pending')], deadLetterTotal: null } } });
		expect(dialog()?.textContent).not.toContain('Showing');
	});

	it('offers replay, dismiss and delete on a pending entry only, each posting its id', () => {
		render(DeadLetterDrawer, { props: { form: { deadLetters: [entry('a', 'pending'), entry('b', 'replayed')] } } });
		for (const action of ['?/dead-letter-replay', '?/dead-letter-dismiss', '?/dead-letter-delete']) {
			const posted = [...document.body.querySelectorAll<HTMLFormElement>(`form[action="${action}"]`)];
			expect(posted, action).toHaveLength(1);
			expect(new FormData(posted[0]).get('id')).toBe('a');
		}
	});

	it('drops a deleted entry from the list once the delete succeeds', async () => {
		render(DeadLetterDrawer, { props: { form: { deadLetters: [entry('a', 'pending'), entry('c', 'pending')] } } });
		const del = forms.submits.find((f) => f.node.getAttribute('action') === '?/dead-letter-delete' && f.node.isConnected);
		const submit = del?.submit as () => (input: { result: { type: string }; update: () => Promise<void> }) => Promise<void>;
		await submit()({ result: { type: 'success' }, update: async () => {} });
		flushSync();
		expect(dialog()?.querySelectorAll('tbody tr')).toHaveLength(1);
	});

	it('keeps an entry whose delete failed', async () => {
		render(DeadLetterDrawer, { props: { form: { deadLetters: [entry('a', 'pending')] } } });
		const del = forms.submits.find((f) => f.node.getAttribute('action') === '?/dead-letter-delete' && f.node.isConnected);
		const submit = del?.submit as () => (input: { result: { type: string }; update: () => Promise<void> }) => Promise<void>;
		await submit()({ result: { type: 'failure' }, update: async () => {} });
		flushSync();
		expect(dialog()?.querySelectorAll('tbody tr')).toHaveLength(1);
	});
});

/*
 * Replay and dismiss results land in one map keyed by entry. An effect that
 * tracked the map it rewrote reran on its own write until Svelte threw.
 */
describe('the result of a replay or a dismissal', () => {
	it('settles, shows in place of the entry\'s actions, and keeps the earlier result', async () => {
		const queue = { deadLetters: [entry('a', 'pending'), entry('c', 'pending')] };
		const { rerender } = render(DeadLetterDrawer, { props: { form: queue } });
		await rerender({ form: { deadLetterReplay: { id: 'a', status: 'replayed', http_status: 200 } } });
		const rows = () => [...(dialog()?.querySelectorAll('tbody tr') ?? [])];
		expect(rows()[0].textContent).toContain('Delivered (HTTP 200)');
		expect(rows()[0].querySelector('form')).toBeNull();
		await rerender({ form: { deadLetterDismiss: { id: 'c', status: 'dismissed' } } });
		expect(rows()[1].textContent).toContain('Dismissed');
		expect(rows()[1].querySelector('form')).toBeNull();
		expect(rows()[0].textContent).toContain('Delivered (HTTP 200)');
	});

	// The plugin's status always reads "replayed", and the receiver's code is
	// what says whether the delivery arrived.
	it('reports the code a refusing receiver answered and keeps the entry pending', async () => {
		const { rerender } = render(DeadLetterDrawer, { props: { form: { deadLetters: [entry('a', 'pending')] } } });
		await rerender({ form: { deadLetterReplay: { id: 'a', status: 'replayed', http_status: 502 } } });
		const row = dialog()?.querySelector('tbody tr');
		expect(row?.textContent).toContain('The receiver answered HTTP 502. The entry is still pending.');
		expect(row?.querySelector('form[action="?/dead-letter-replay"]')).not.toBeNull();
	});
});

describe('the queue and its own failures', () => {
	it('shows a failed replay inside the drawer', async () => {
		const { rerender } = render(DeadLetterDrawer, { props: { form: { deadLetters: [entry('a', 'pending')] } } });
		await rerender({ form: { action: 'dead-letter-replay', id: 'a', error: 'dead letter entry is not pending' } });
		expect(dialog()?.textContent).toContain('dead letter entry is not pending');
	});

	it('ignores a failure of another action', async () => {
		const { rerender } = render(DeadLetterDrawer, { props: { form: { deadLetters: [entry('a', 'pending')] } } });
		await rerender({ form: { action: 'delete', error: 'Failed to delete webhook' } });
		expect(dialog()?.textContent).not.toContain('Failed to delete webhook');
	});
});
