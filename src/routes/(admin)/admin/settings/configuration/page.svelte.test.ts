// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ConfigurationPage from './+page.svelte';

afterEach(cleanup);

const settings = [
	{ key: 'jwt_expiry_secs', source: 'admin', value: '900', editable: true, description: 'How long a session token lives.', default: '3600' },
	{ key: 'database_url', source: 'env', value: 'postgres://db', editable: false },
	{ key: 'smtp_password', source: 'file', origin: '/etc/lyeve/lyeve.yaml', editable: false, secret: true },
];

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			provenance: { ok: true, value: { settings, counts: { env: 1, file: 1, admin: 1 }, suppressed: [] } },
			plugin: null,
			...over,
		},
		form,
	} as never;
}

/** The block that holds one setting: the widest ancestor of its name that names no other setting. */
function row(key: string): HTMLElement {
	let el = screen.getByText(key, { selector: 'code' }) as HTMLElement;
	const others = settings.map((s) => s.key).filter((k) => k !== key);
	while (el.parentElement && !others.some((k) => el.parentElement?.textContent?.includes(k))) el = el.parentElement;
	return el;
}

describe('the configuration page', () => {
	it('saves an editable setting from its own row', async () => {
		render(ConfigurationPage, { props: props() });
		const input = screen.getByLabelText('jwt_expiry_secs') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '1800' } });
		const form = input.closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/save');
		const sent = new FormData(form);
		expect([sent.get('key'), sent.get('value'), sent.get('secret')]).toEqual(['jwt_expiry_secs', '1800', 'false']);
	});

	it('says what pins a setting it cannot edit, and never shows a stored secret', () => {
		render(ConfigurationPage, { props: props() });
		expect(row('database_url').textContent).toContain('Set by an environment variable, which always wins.');
		expect(row('database_url').querySelector('form')).toBeNull();
		const secret = row('smtp_password');
		expect(secret.textContent).toContain('Pinned by /etc/lyeve/lyeve.yaml. Tag the value !overridable to edit it here.');
		expect(secret.textContent).toContain('Stored, not shown.');
	});

	it('offers no save for a setting the engine reads only at start, and says how to set it', () => {
		const atStart = { key: 'refresh_token_ttl_secs', source: 'default', editable: false, read_at_start: true };
		render(ConfigurationPage, {
			props: props({ provenance: { ok: true, value: { settings: [atStart], counts: {}, suppressed: [] } } }),
		});
		expect(screen.queryByLabelText('refresh_token_ttl_secs')).toBeNull();
		expect(document.body.textContent).toContain(
			'Read only when the engine starts. Set it with an environment variable or in the configuration file, then restart.'
		);
		expect(document.body.textContent).not.toContain('The engine is using it now.');
	});

	it('shows a refused save under the setting it belongs to only', () => {
		render(ConfigurationPage, { props: props({}, { key: 'jwt_expiry_secs', error: 'jwt_expiry_secs must be at least 60' }) });
		expect(row('jwt_expiry_secs').textContent).toContain('jwt_expiry_secs must be at least 60');
		expect(screen.getAllByRole('alert').filter((a) => a.textContent?.includes('at least 60'))).toHaveLength(1);
	});

	it('filters by name or by what a setting does', async () => {
		render(ConfigurationPage, { props: props() });
		await fireEvent.input(screen.getByPlaceholderText('Name or what it does'), { target: { value: 'session token' } });
		expect(screen.queryByText('database_url', { selector: 'code' })).toBeNull();
		expect(screen.getByText('jwt_expiry_secs', { selector: 'code' })).toBeTruthy();
		await fireEvent.input(screen.getByPlaceholderText('Name or what it does'), { target: { value: 'nothing like this' } });
		expect(screen.getByText('No setting matches that filter')).toBeTruthy();
	});

	it('warns about settings an empty variable holds empty', () => {
		render(ConfigurationPage, {
			props: props({ provenance: { ok: true, value: { settings, counts: {}, suppressed: ['redis_url'] } } }),
		});
		expect(screen.getByText('Held empty by an environment variable')).toBeTruthy();
		expect(screen.getByText('redis_url')).toBeTruthy();
	});

	it('lists only the settings of the plugin it was opened for', () => {
		render(ConfigurationPage, { props: props({ plugin: { name: 'auth', found: true, keys: ['jwt_expiry_secs'] } }) });
		expect(screen.getByText(/Showing the settings of the/)).toBeTruthy();
		expect(screen.queryByText('database_url', { selector: 'code' })).toBeNull();
		expect(screen.getByRole('link', { name: 'Show every setting' }).getAttribute('href')).toBe('/admin/settings/configuration');
	});

	it('says a failed read is a failure, not an engine with nothing set', () => {
		const { container } = render(ConfigurationPage, { props: props({ provenance: { ok: false, gate: { state: 'unavailable' } } }) });
		expect(container.textContent).not.toContain('No settings reported');
		expect(screen.queryByLabelText('jwt_expiry_secs')).toBeNull();
	});
});
