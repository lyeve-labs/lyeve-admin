// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kit = vi.hoisted(() => ({ confirm: vi.fn(async (_title: string, _body: string, _opts?: unknown) => true), success: vi.fn() }));
vi.mock('@lyeve-labs/ui-kit', () => ({ confirm: kit.confirm, toast: { success: kit.success } }));

import { DdlHistory } from './ddl-history.svelte';

type Source = { table: string | undefined; isSuperAdmin: boolean; rowCounts: Record<string, number> };

let teardown: (() => void) | undefined;
afterEach(() => teardown?.());
beforeEach(() => {
	kit.confirm.mockClear();
	kit.success.mockClear();
});

/** Builds the history inside an effect root, the way a component would, with a form it can submit. */
function setup(initial: Partial<Source> = {}) {
	const src = $state<Source>({ table: 'posts', isSuperAdmin: true, rowCounts: {}, ...initial });
	let ddl!: DdlHistory;
	teardown = $effect.root(() => {
		ddl = new DdlHistory({ table: () => src.table, isSuperAdmin: () => src.isSuperAdmin, rowCounts: () => src.rowCounts });
	});
	const submit = vi.fn();
	const apply = vi.fn();
	ddl.form = { requestSubmit: submit } as unknown as HTMLFormElement;
	ddl.applyForm = { requestSubmit: apply } as unknown as HTMLFormElement;
	flushSync();
	return { src, ddl, submit, apply };
}

async function answer(fn: DdlHistory['submit'], result: unknown) {
	const after = (await fn({} as never)) as (a: unknown) => Promise<void>;
	await after({ result });
}

describe('DdlHistory', () => {
	it('reads the history once when the section opens', () => {
		const { ddl, submit } = setup();
		expect(submit).not.toHaveBeenCalled();
		ddl.open = true;
		flushSync();
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it('reads nothing for a role below super admin', () => {
		const { ddl, submit } = setup({ isSuperAdmin: false });
		ddl.open = true;
		flushSync();
		expect(submit).not.toHaveBeenCalled();
	});

	it('keeps a read and drops it when another table is opened', async () => {
		const { src, ddl } = setup();
		await answer(ddl.submit, { type: 'success', data: { name: 'posts', entries: [], pending: 2, limit: 200 } });
		expect(ddl.view).toEqual({ name: 'posts', entries: [], pending: 2, limit: 200 });
		src.table = 'authors';
		flushSync();
		expect(ddl.view).toBeNull();
	});

	it('says the read failed rather than showing an empty history', async () => {
		const { ddl } = setup();
		await answer(ddl.submit, { type: 'failure', data: { error: 'The engine did not answer.' } });
		expect(ddl.error).toBe('The engine did not answer.');
		await answer(ddl.submit, { type: 'error' });
		expect(ddl.error).toBe('The admin could not reach the engine.');
		expect(ddl.view).toBeNull();
	});

	it('asks before applying, with the row count it read, then applies', async () => {
		const { ddl, apply } = setup({ rowCounts: { posts: 1 } });
		await answer(ddl.submit, { type: 'success', data: { name: 'posts', entries: [], pending: 1, limit: 200 } });
		await ddl.applyQueued();
		expect(kit.confirm.mock.calls[0][0]).toBe('Apply 1 queued change to posts?');
		expect(kit.confirm.mock.calls[0][1]).toContain('The table holds 1 row');
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it('says the count could not be read before applying, and that the table may hold data', async () => {
		const { ddl, apply } = setup({ rowCounts: {} });
		await answer(ddl.submit, { type: 'success', data: { name: 'posts', entries: [], pending: 2, limit: 200 } });
		await ddl.applyQueued();
		expect(kit.confirm.mock.calls[0][0]).toBe('Apply 2 queued changes to posts?');
		const body = kit.confirm.mock.calls[0][1];
		expect(body).toContain('How many rows the table holds could not be read. It may hold data');
		expect(body).not.toMatch(/holds 0 rows/);
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it('keeps a failed apply apart from the read that follows it', async () => {
		const { ddl, submit } = setup();
		await answer(ddl.submitApply, { type: 'failure', data: { error: 'The queued changes could not be applied.' } });
		expect(submit).toHaveBeenCalledTimes(1);
		await answer(ddl.submit, { type: 'success', data: { name: 'posts', entries: [], pending: 0, limit: 200 } });
		expect(ddl.applyError).toBe('The queued changes could not be applied.');
	});
});
