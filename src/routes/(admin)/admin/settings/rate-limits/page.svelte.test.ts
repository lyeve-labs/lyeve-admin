// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy() {} }),
}));

import RateLimitsPage from './+page.svelte';

afterEach(() => cleanup());

const customRule = {
	id: 'r1',
	tenant_id: null,
	endpoint: 'GET /api/content/{schema}',
	rate: 1,
	burst: 5,
	enabled: true,
	kind: 'custom',
	role: 'editor',
	key_by: 'user',
	enforced: false,
	created_at: '2026-09-23T00:00:00Z',
	updated_at: '2026-09-23T00:00:00Z',
};

const protection = {
	name: 'POST /api/admin/auth/login',
	plugin: 'rate-limit',
	description: 'Sign-in attempts per address.',
	route: true,
	requests: 5,
	window_seconds: 900,
	default_requests: 5,
	default_window_seconds: 900,
	customized: false,
};

function setup(over: { customEnabled?: boolean | null; superAdmin?: boolean; rules?: unknown[] } = {}) {
	const customEnabled = over.customEnabled === undefined ? false : over.customEnabled;
	return render(RateLimitsPage, {
		props: {
			data: {
				rules: over.rules ?? [customRule],
				total: 1,
				limit: 50,
				offset: 0,
				hasMore: false,
				overview:
					customEnabled === null
						? null
						: {
								custom_licensed: customEnabled,
								global: {
									...customRule,
									id: 'g1',
									endpoint: '*',
									kind: 'global',
									role: null,
									key_by: 'ip',
									enabled: false,
									enforced: false,
								},
								protections: [protection],
								engine: [
									{
										scope: 'public',
										endpoint: 'POST /api/admin/auth/login',
										rate: 5,
										burst: 10,
										source: 'environment',
										setting: 'PUBLIC_RATE_LIMITS',
									},
								],
							},
				superAdmin: over.superAdmin ?? true,
				status: [],
				statusRead: true,
				gate: { state: 'ok' },
				installed: true,
			},
			form: null,
		} as never,
	});
}

describe('rate-limits page', () => {
	it('without the capability, shows custom rules as not enabled and says stored ones are not enforced', () => {
		const { getByText, queryByRole } = setup({ customEnabled: false });
		expect(getByText('Custom rate limits')).toBeTruthy();
		expect(getByText(/stored rule is not enforced/)).toBeTruthy();
		expect(getByText('Not enforced')).toBeTruthy();
		expect(queryByRole('button', { name: /New rule/ })).toBeNull();
		expect(queryByRole('button', { name: /Edit POST \/api\/admin\/auth\/login/ })).toBeNull();
	});

	it('with the capability, offers a new rule and editing a protection', () => {
		const { getAllByRole, getByRole } = setup({ customEnabled: true, rules: [{ ...customRule, enforced: true }] });
		expect(getAllByRole('button', { name: /New rule/ }).length).toBeGreaterThan(0);
		expect(getByRole('button', { name: /Edit POST \/api\/admin\/auth\/login/ })).toBeTruthy();
	});

	it('shows a tenant admin the global limit without an edit control or the thresholds', () => {
		const { getByText, queryByRole, queryByText } = setup({ customEnabled: true, superAdmin: false });
		expect(getByText('Every request, per address, every tenant')).toBeTruthy();
		expect(queryByRole('button', { name: 'Edit the global limit' })).toBeNull();
		expect(queryByText('Sign-in and reset protections')).toBeNull();
	});

	it('names the setting behind an engine limit', () => {
		const { getByText } = setup();
		expect(getByText('PUBLIC_RATE_LIMITS')).toBeTruthy();
	});

	it('treats an unread overview as unknown rather than locked', () => {
		const { getByText, queryByText } = setup({ customEnabled: null });
		expect(getByText(/whether they are enforced is unknown/)).toBeTruthy();
		expect(queryByText('Custom rate limits')).toBeNull();
	});
});
