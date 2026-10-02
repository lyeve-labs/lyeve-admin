// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
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
