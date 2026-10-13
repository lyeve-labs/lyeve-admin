// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import StoragePage from './+page.svelte';
import type { StorageProvider } from '$lib/api/storage';

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
