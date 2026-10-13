// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

const forms = vi.hoisted(() => ({ submits: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.set(el.getAttribute('action') ?? '', fn);
		return { destroy: () => {} };
	},
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import RetentionPage from './+page.svelte';
import type { LegalHold, RetentionPolicy } from '$lib/api/retention';

beforeEach(() => {
	forms.submits.clear();
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});
afterEach(cleanup);

const policy: RetentionPolicy = {
	id: 'p1',
	event_type: 'content.delete',
	resource_type: 'article',
	retention_days: 90,
	archival_enabled: false,
	archival_storage: '',
	archival_path_prefix: '',
	tenant_id: 'default',
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const hold: LegalHold = {
	id: 'h1',
	name: 'Litigation 42',
	description: '',
	filter_action: '',
	filter_resource_type: 'article',
	filter_resource_id: '',
	filter_tenant_id: '',
	tenant_id: 'default',
	created_at: '2026-10-01T00:00:00Z',
	created_by: 'u1',
};

function props(roles: string[], over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			user: { id: 'u1', roles },
			policies: [policy],
			holds: { ok: true, value: [hold] },
			gate: { state: 'ok' },
			...over,
		} as never,
		form: form as never,
	};
}

// The audit plugin takes every retention write from a super admin only.
describe('Retention controls by role', () => {
	it('offers every write to a super admin', () => {
		const { container, getAllByRole } = render(RetentionPage, { props: props(['super_admin']) });
		expect(getAllByRole('button', { name: /enforce now/i })).toHaveLength(1);
		expect(getAllByRole('button', { name: /new policy/i }).length).toBeGreaterThan(0);
		expect(getAllByRole('button', { name: /new hold/i }).length).toBeGreaterThan(0);
		expect(container.querySelector('[aria-label^="Delete the policy"]')).not.toBeNull();
		expect(container.querySelector('[aria-label^="Duplicate the policy"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="Release Litigation 42"]')).not.toBeNull();
	});

	it('withholds every write from an admin and says who can make them', () => {
		const { container, queryByRole } = render(RetentionPage, { props: props(['admin']) });
		expect(queryByRole('button', { name: /enforce now/i })).toBeNull();
		expect(queryByRole('button', { name: /new policy/i })).toBeNull();
		expect(queryByRole('button', { name: /new hold/i })).toBeNull();
		expect(container.querySelector('[aria-label^="Delete the policy"]')).toBeNull();
		expect(container.querySelector('[aria-label^="Duplicate the policy"]')).toBeNull();
		expect(container.querySelector('[aria-label="Release Litigation 42"]')).toBeNull();
		expect(container.textContent).toContain('Only a super admin can change a retention policy');
	});
});

describe('Retention policy delete', () => {
	it('names the policy in the confirmation title', async () => {
		render(RetentionPage, { props: props(['super_admin']) });
		const submit = forms.submits.get('?/deletePolicy');
		expect(submit).toBeTypeOf('function');
		await submit?.({ cancel: vi.fn() } as never);
		const [title] = kit.confirm.mock.calls[0] as unknown as [string];
		expect(title).toBe('Delete the policy covering content.delete on article');
	});
});

describe('Retention drawers', () => {
	it('shows a refused policy inside the open drawer', async () => {
		const { getAllByRole } = render(RetentionPage, {
			props: props(['super_admin'], {}, { error: 'A retention window is a whole number of days, and cannot be negative.' }),
		});
		await fireEvent.click(getAllByRole('button', { name: /new policy/i })[0]);
		const form = document.getElementById('policy-form') as HTMLFormElement;
		expect(form.textContent).toContain('A retention window is a whole number of days');
	});
});

describe('Retention holds that could not be read', () => {
	it('says so instead of reporting that nothing is held', () => {
		const { container } = render(RetentionPage, {
			props: props(['super_admin'], {
				holds: {
					ok: false,
					gate: {
						state: 'error',
						message: 'The holds could not be read, so the policies above cannot be trusted to describe what is actually being deleted.',
					},
				},
			}),
		});
		expect(container.textContent).toContain('The holds could not be read');
		expect(container.textContent).not.toContain('Nothing is held');
	});
});
