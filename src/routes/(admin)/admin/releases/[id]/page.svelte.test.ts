// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ReleasePage from './+page.svelte';

afterEach(cleanup);

const release = {
	id: 'r1',
	name: 'Launch',
	description: '',
	status: 'draft',
	created_by: 'u1',
	updated_by: 'u1',
	created_at: '',
	updated_at: '',
	item_count: 1,
	items: [{ entry_id: 'e1', action: 'publish', added_by: 'u1', created_at: '' }],
};

function setup(data: Record<string, unknown> = {}, form: unknown = null) {
	return render(ReleasePage, {
		props: {
			data: { release, gate: { state: 'ok' }, conflicts: [], conflictsRead: true, labels: { e1: { title: 'Hello', schema: 'posts', status: 'draft' } }, ...data },
			form,
		} as never,
	});
}

describe('release page', () => {
	it('links each entry to its editor by the collection it lives in', () => {
		const { getByRole } = setup();
		expect(getByRole('link', { name: 'Hello' }).getAttribute('href')).toBe('/admin/content/posts/e1');
	});

	it('lists a blocking conflict and holds back the publish', () => {
		const { getByTestId, getByRole } = setup({ conflicts: [{ entry_id: 'e1', kind: 'other_release', detail: '', release_id: 'r2' }] });
		expect(getByTestId('release-conflicts').textContent).toContain('Another scheduled release also moves it');
		expect((getByRole('button', { name: /Publish now/ }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('shows the conflicts a refused publish returned', () => {
		const { getByTestId } = setup({}, { error: 'conflicts', conflicts: [{ entry_id: 'e1', kind: 'entry_schedule', detail: '' }] });
		expect(getByTestId('release-conflicts').textContent).toContain('Has its own publish or unpublish date');
	});

	it('renders a refused write as the refusal notice', () => {
		const { getAllByTestId } = setup({}, { error: 'x', refused: { kind: 'feature', feature: 'example-capability', plugin: 'example', upgradeUrl: '' } });
		expect(getAllByTestId('refusal-notice')[0].textContent).toContain('example-capability');
	});

	it('offers no edits once the release went out', () => {
		const { queryByRole } = setup({ release: { ...release, status: 'published', published_at: '2026-10-01T00:00:00Z' } });
		expect(queryByRole('button', { name: /Publish now/ })).toBeNull();
		expect(queryByRole('button', { name: /Include entry/ })).toBeNull();
	});
});

describe('including an entry', () => {
	const choices = [
		{ id: 'e2', title: 'Pricing', slug: 'pricing', schema: 'pages' },
		{ id: 'e3', title: '', slug: 'spring-sale', schema: 'posts' },
	];

	it('offers the entries by title to pick from, and adds the one picked', async () => {
		const { getByRole, getAllByRole, queryByRole } = setup({ choices });
		await fireEvent.click(getByRole('button', { name: /Include entry/ }));
		expect(queryByRole('textbox', { name: /Entry ID/ })).toBeNull();
		await fireEvent.click(document.getElementById('release-entry') as HTMLElement);
		expect(getAllByRole('option').map((o) => o.textContent?.trim())).toEqual(['Pricing', 'spring-sale']);
		await fireEvent.click(getByRole('option', { name: 'Pricing' }));
		expect((document.querySelector('input[name="entry_id"]') as HTMLInputElement).value).toBe('e2');
		const add = getByRole('button', { name: 'Include' }) as HTMLButtonElement;
		expect(add.disabled).toBe(false);
		expect(queryByRole('button', { name: 'Create' })).toBeNull();
	});

	it('asks for an id when the entries could not be read', async () => {
		const { getByRole } = setup({ choices: null });
		await fireEvent.click(getByRole('button', { name: /Include entry/ }));
		expect(getByRole('textbox', { name: /Entry ID/ })).toBeTruthy();
	});
});
