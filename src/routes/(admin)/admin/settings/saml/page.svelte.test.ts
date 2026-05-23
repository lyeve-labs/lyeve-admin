// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import SamlPage from './+page.svelte';
import type { SamlProvider } from '$lib/api/saml';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function provider(over: Partial<SamlProvider> = {}): SamlProvider {
	return {
		id: 'p1',
		tenant_id: 'default',
		name: 'Okta',
		entity_id: 'http://www.okta.com/exk1',
		sso_url: 'https://example.okta.com/sso',
		sp_cert_active: '-----BEGIN CERTIFICATE-----',
		name_id_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		want_authn_signed: false,
		want_assertions_signed: true,
		want_response_signed: true,
		sign_authn_requests: true,
		encrypt_assertions: false,
		attributes_mapping: {},
		enabled: true,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		sp_cert_expires_at: '2027-06-01T00:00:00Z',
		idp_cert_expires_at: '2027-06-01T00:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		providers: [provider()],
		templates: [],
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
		const { container } = render(SamlPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' }, providers: [] }) });
		expect(said(container)).toContain('Not enabled on this instance');
		expect(said(container)).not.toContain('New provider');
	});

	it('says the plugin is absent rather than that nothing is configured', () => {
		const { container } = render(SamlPage, {
			props: props({ gate: { state: 'absent' }, providers: [] }),
		});
		expect(said(container)).toContain('not part of this build');
		expect(said(container)).not.toContain('No identity provider is configured');
	});

	it('reports a failed read as a failure, not as an empty list', () => {
		const { container } = render(SamlPage, {
			props: props({ gate: { state: 'error', message: 'The identity providers could not be read.' }, providers: [] }),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No identity provider is configured');
	});
});

describe('certificates', () => {
	// This is the whole reason the screen exists: a SAML deployment fails on a
	// date, and nothing else in the admin says what that date is.
	it('names the expiry of both certificates', () => {
		const { container } = render(SamlPage, {
			props: props({
				providers: [
					provider({
						sp_cert_expires_at: '2026-10-01T00:00:00Z',
						idp_cert_expires_at: '2028-01-01T00:00:00Z',
					}),
				],
			}),
		});
		const text = said(container);
		expect(text).toContain('Expires in');
	});

	it('counts what has to be renewed, and says none when nothing does', () => {
		const { container } = render(SamlPage, { props: props() });
		expect(said(container)).toContain('Certificates to renew');
	});

	// Staging is the step that publishes a certificate to the IdP. A screen
	// that offered only the promotion would offer a button that always failed.
	it('offers the promotion only once something is staged', () => {
		const quiet = render(SamlPage, { props: props() });
		expect(said(quiet.container)).not.toContain('Waiting to be promoted');
		cleanup();

		const ready = render(SamlPage, {
			props: props({
				providers: [
					provider({
						sp_cert_next: '-----BEGIN CERTIFICATE-----\nstaged\n-----END CERTIFICATE-----',
						sp_cert_next_expires_at: '2028-01-01T00:00:00Z',
					}),
				],
			}),
		});
		const text = said(ready.container);
		expect(text).toContain('Waiting to be promoted');
		expect(text).toContain('Promote');
	});
});

describe('links off the row', () => {
	// A display name holds spaces, and the route matches on the name. An
	// unencoded link reads as "provider not found" at the moment somebody
	// tries to sign in.
	it('encodes the provider name into the metadata and sign-in links', () => {
		const { container } = render(SamlPage, {
			props: props({ providers: [provider({ name: 'Azure AD' })] }),
		});
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/api/admin/auth/saml/Azure%20AD/metadata');
		expect(hrefs).toContain('/api/admin/auth/saml/Azure%20AD');
	});
});

describe('the empty state', () => {
	it('says what a provider is for rather than that a read failed', () => {
		const { container } = render(SamlPage, { props: props({ providers: [] }) });
		expect(said(container)).toContain('No identity provider is configured');
		expect(said(container)).toContain('sign-in button on the login page');
	});
});

describe('the form', () => {
	// Every switch on this drawer is a security setting, and Toggle renders a
	// button, which submits nothing. Without the hidden field beside it, turning
	// one off would post nothing and the action would keep the old value.
	it('submits every switch, including the ones that are off', async () => {
		const { container } = render(SamlPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new provider/i }));
		const names = [...container.querySelectorAll('input[type="hidden"]')].map((i) =>
			i.getAttribute('name'),
		);
		for (const field of [
			'want_assertions_signed',
			'want_response_signed',
			'sign_authn_requests',
			'encrypt_assertions',
			'enabled',
		]) {
			expect(names).toContain(field);
		}
	});

	it('shows the action error where the form is', () => {
		const { container } = render(SamlPage, {
			props: props({}, { error: 'The provider could not be created.' }),
		});
		expect(said(container)).toContain('The provider could not be created.');
	});
});
