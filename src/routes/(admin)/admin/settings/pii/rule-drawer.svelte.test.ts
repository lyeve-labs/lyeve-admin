// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

/*
 * The rule form's submit function decides whether the drawer closes. It is
 * captured here and driven with each kind of result, which is what the
 * browser hands it after the action answers.
 */
const forms = vi.hoisted(() => ({ submits: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.set(el.getAttribute('action') ?? '', fn);
		return { destroy: () => {} };
	},
}));

import PiiPage from './+page.svelte';

beforeEach(() => forms.submits.clear());
afterEach(cleanup);

const data = {
	rules: { presets: [], mask_tags: {}, custom: [] },
	entries: [],
	total: 0,
	limit: 50,
	offset: 0,
	gate: { state: 'ok' },
	logFailed: false,
};

async function submitNewRule(result: { type: string }) {
	render(PiiPage, { props: { data: data as never, form: null as never } });
	await fireEvent.click(screen.getAllByRole('button', { name: /new rule/i })[0]);
	await tick();
	const submit = forms.submits.get('?/create');
	expect(submit).toBeTypeOf('function');
	const after = (await submit?.({} as never)) as (opts: unknown) => Promise<void>;
	await after({ result, update: vi.fn(async () => {}) });
	await tick();
}

describe('PII rule drawer after a save', () => {
	it('stays open when the save is refused', async () => {
		await submitNewRule({ type: 'failure' });
		expect(document.querySelector('form[action="?/create"]')).not.toBeNull();
	});

	it('closes when the save succeeds', async () => {
		await submitNewRule({ type: 'success' });
		expect(document.querySelector('form[action="?/create"]')).toBeNull();
	});
});
