// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, SubmitFunction } from '@sveltejs/kit';

const nav = vi.hoisted(() => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

/*
 * enhance is mocked to hand back the submit function the component gave it.
 * Driving that directly exercises what the component does with each kind of
 * ActionResult without a real submission, which in jsdom would need the whole
 * router.
 */
const forms = vi.hoisted(() => ({ submits: [] as SubmitFunction[] }));
vi.mock('$app/forms', () => ({
	enhance: (_el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.push(fn);
		return { destroy: () => {} };
	},
}));

import DbStatus from './DbStatus.svelte';

beforeEach(() => {
	forms.submits = [];
	nav.invalidateAll.mockClear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** Runs the captured submit function and hands it one action result. */
async function submit(result: ActionResult): Promise<void> {
	const started = forms.submits[0];
	const done = (await started({} as never)) as (arg: { result: ActionResult }) => Promise<void>;
	await done({ result });
}

describe('DbStatus', () => {
	// A read belongs in `load` and a write in a form action, so the script here
	// makes no call of its own.
	it('asks the engine for nothing of its own', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		render(DbStatus, { props: { pending: 3, redirectTo: '/admin/media' } });

		await waitFor(() => expect(screen.getByTestId('db-status')).toBeTruthy());
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports a database that matches the schemas', () => {
		render(DbStatus, { props: { pending: 0, redirectTo: '/admin' } });

		expect(screen.getByText('Database synced')).toBeTruthy();
		expect(document.querySelector('form')).toBeNull();
	});

	it('says the count is unknown when the shell got no answer', () => {
		// Reading no answer as zero would paint the chip green and claim the
		// database is in step with a server that has not spoken.
		render(DbStatus, { props: { pending: null, redirectTo: '/admin' } });

		expect(screen.getByText('Database unknown')).toBeTruthy();
		expect(screen.queryByText('Database synced')).toBeNull();
	});

	it('makes the pending count the control that clears it', () => {
		// The count and the action are one thing, not a label pointing at a
		// control somewhere else.
		render(DbStatus, { props: { pending: 3, redirectTo: '/admin/media?limit=25' } });

		const button = screen.getByTestId('db-status');
		expect(button.textContent).toContain('3 pending');
		expect(button.getAttribute('type')).toBe('submit');
	});

	// Without JavaScript this is the whole mechanism: a POST to a real action,
	// carrying the page to come back to.
	it('applies through the form action rather than a fetch', () => {
		render(DbStatus, { props: { pending: 1, redirectTo: '/admin/media?limit=25' } });

		const form = document.querySelector('form');
		expect(form?.getAttribute('method')).toBe('POST');
		expect(form?.getAttribute('action')).toBe('/admin?/applyMigrations');

		const back = form?.querySelector('input[name="redirectTo"]') as HTMLInputElement;
		expect(back.value).toBe('/admin/media?limit=25');
	});

	it('names the failure rather than falling silent', async () => {
		render(DbStatus, { props: { pending: 1, redirectTo: '/admin' } });

		await submit({ type: 'failure', status: 400, data: { error: 'migration 059 failed' } });

		await waitFor(() => expect(screen.getByText('migration 059 failed')).toBeTruthy());
		expect(nav.invalidateAll).not.toHaveBeenCalled();
	});

	it('falls back to a message of its own when the action names none', async () => {
		render(DbStatus, { props: { pending: 1, redirectTo: '/admin' } });

		await submit({ type: 'failure', status: 400, data: {} });

		await waitFor(() => expect(screen.getByText('Migration failed')).toBeTruthy());
	});

	it('reports a request that never arrived', async () => {
		render(DbStatus, { props: { pending: 1, redirectTo: '/admin' } });

		await submit({ type: 'error', error: new Error('offline') });

		await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
	});

	// The action redirects so that a submission without JavaScript lands
	// somewhere. Here the count is refreshed in place instead.
	it('refreshes the shell rather than following the redirect', async () => {
		render(DbStatus, { props: { pending: 2, redirectTo: '/admin/schema' } });

		await submit({ type: 'redirect', status: 303, location: '/admin/schema' });

		expect(nav.invalidateAll).toHaveBeenCalledTimes(1);
		expect(screen.queryByText('Network error')).toBeNull();
	});
});
