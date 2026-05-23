// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import ScimPage from './+page.svelte';
import type { ScimProvider } from '$lib/api/scim';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function provider(over: Partial<ScimProvider> = {}): ScimProvider {
	return {
		id: 'c1',
		name: 'Azure AD',
		enabled: true,
		tenant_id: 'default',
		attribute_map: {},
		deprovision_on_delete: true,
		deprovision_action: 'disable',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		providers: [provider()],
		total: 1,
		limit: 25,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		licensed: true,
		...over,
	} as never,
	form: form as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(ScimPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, providers: [] }),
		});
		expect(said(container)).toContain('Not enabled on this instance');
		expect(said(container)).not.toContain('New connection');
	});

	it('says the plugin is absent rather than that nothing is connected', () => {
		const { container } = render(ScimPage, {
			props: props({ gate: { state: 'absent' }, providers: [] }),
		});
		expect(said(container)).toContain('not part of this build');
		expect(said(container)).not.toContain('No directory is connected');
	});

	it('reports a failed read as a failure, not as an empty list', () => {
		const { container } = render(ScimPage, {
			props: props({ gate: { state: 'error', message: 'The connections could not be read.' }, providers: [] }),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No directory is connected');
	});
});

describe('the rows', () => {
	// This is the fact an auditor asks about, and the two fields behind it are
	// stored independently, so the row has to answer it in words.
	it('says what happens to a deprovisioned account', () => {
		const { container } = render(ScimPage, {
			props: props({ providers: [provider({ deprovision_action: 'delete' })] }),
		});
		expect(said(container)).toContain('Deleted');
	});

	it('says an account is left alone when deprovisioning is off', () => {
		const { container } = render(ScimPage, {
			props: props({
				providers: [provider({ deprovision_on_delete: false, deprovision_action: 'delete' })],
			}),
		});
		expect(said(container)).toContain('Left alone');
		expect(said(container)).not.toContain('Deleted');
	});

	it('offers a rotation for every connection, since the token cannot be read back', () => {
		const { getByLabelText } = render(ScimPage, { props: props() });
		expect(getByLabelText('Rotate the token for Azure AD')).toBeTruthy();
	});
});

describe('the connection form', () => {
	it('submits the deprovision switch even when it is off', async () => {
		const { container } = render(ScimPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
		const names = [...container.querySelectorAll('input[type="hidden"]')].map((i) =>
			i.getAttribute('name'),
		);
		expect(names).toContain('deprovision_on_delete');
	});

	it('warns that rotating breaks provisioning until the directory is updated', async () => {
		const { container } = render(ScimPage, { props: props() });
		await fireEvent.click(screen.getByLabelText('Rotate the token for Azure AD'));
		expect(said(container)).toContain('stops working the moment this one is stored');
	});
});

describe('the empty state', () => {
	it('says what a connection is for rather than that a read failed', () => {
		const { container } = render(ScimPage, { props: props({ providers: [] }) });
		expect(said(container)).toContain('No directory is connected');
	});
});
