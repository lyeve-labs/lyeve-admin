// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import StoragePage from './+page.svelte';
import type { StorageProvider } from '$lib/api/storage';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

const provider: StorageProvider = {
	id: 'p1',
	tenant_id: 'default',
	provider_type: 's3',
	name: 'Uploads bucket',
	bucket: 'uploads',
	use_ssl: true,
	path_style: false,
	cost_weight: 1,
	priority: 10,
	enabled: true,
	local_public_unsigned: false,
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const props = (over: Record<string, unknown> = {}) => ({
	data: { providers: [provider], gate: { state: 'ok' }, canConfigure: true, ...over } as never,
	form: null as never,
});

// The storage plugin takes a create, a change and a delete from a super
// admin only. An admin may test a provider and nothing else.
describe('Storage controls by role', () => {
	it('offers a super admin the delete', () => {
		const { container } = render(StoragePage, { props: props() });
		expect(container.querySelector('[aria-label="Delete Uploads bucket"]')).not.toBeNull();
	});

	it('withholds the delete from an admin and says who can change a provider', () => {
		const { container } = render(StoragePage, { props: props({ canConfigure: false }) });
		expect(container.querySelector('[aria-label="Delete Uploads bucket"]')).toBeNull();
		expect(container.querySelector('[aria-label="Test Uploads bucket"]')).not.toBeNull();
		expect(container.textContent).toContain('Only a super admin can add, change or delete a provider.');
	});

	it('offers the action that fills an empty list to a super admin only', () => {
		const owner = render(StoragePage, { props: props({ providers: [] }) });
		expect(owner.getAllByRole('button', { name: /new provider/i }).length).toBeGreaterThan(1);
		cleanup();

		const admin = render(StoragePage, { props: props({ providers: [], canConfigure: false }) });
		expect(admin.queryByRole('button', { name: /new provider/i })).toBeNull();
	});
});

describe('the provider drawer', () => {
	const failed = { action: 'create', providerError: 'The provider could not be created.' };

	it('keeps a failed create out of an edit opened after it', async () => {
		const { getByRole } = render(StoragePage, { props: { ...props(), form: failed as never } });
		getByRole('button', { name: 'Edit Uploads bucket' }).click();
		await new Promise((r) => setTimeout(r, 0));
		const drawer = document.body.querySelector('form#provider-form');
		expect(drawer).not.toBeNull();
		expect(drawer?.textContent).not.toContain('The provider could not be created.');
	});

	it('shows a failed create that came back while the create drawer was open', async () => {
		const { getAllByRole, rerender } = render(StoragePage, { props: props() });
		getAllByRole('button', { name: /new provider/i })[0].click();
		await new Promise((r) => setTimeout(r, 0));
		await rerender({ ...props(), form: failed as never });
		expect(document.body.querySelector('form#provider-form')?.textContent).toContain('The provider could not be created.');
	});
});

describe('an edit save', () => {
	it('sends back the stored cost weight on an edit', async () => {
		const { getByRole } = render(StoragePage, { props: props() });
		getByRole('button', { name: 'Edit Uploads bucket' }).click();
		await new Promise((r) => setTimeout(r, 0));
		const drawer = document.body.querySelector('form#provider-form') as HTMLFormElement;
		expect(new FormData(drawer).get('cost_weight')).toBe('1');
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(StoragePage, { props: props() });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time with nothing in it yet', () => {
		const { container } = render(StoragePage, { props: props({ providers: [] }) });
		expect(outlineSkips(container)).toEqual([]);
	});
});
