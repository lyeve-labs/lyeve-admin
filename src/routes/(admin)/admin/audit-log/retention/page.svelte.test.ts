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
