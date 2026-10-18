// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AA') } }));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const licensed = { plan: 'example', state: 'active', features: ['mfa'], tenant_quota: 1 };

function setup(mfaEnabled: boolean | { ok: false; gate: unknown }, form: unknown = null, hasPasskeys = false) {
	const mfa = typeof mfaEnabled === 'boolean' ? { ok: true, value: { enabled: mfaEnabled, hasPasskeys } } : mfaEnabled;
	return render(Page, { props: { data: { mfa, entitlements: licensed }, form } as never });
}

describe('an account with a passkey', () => {
	it('says passkeys keep two-factor on and offers both app controls', () => {
		const { container, getByRole } = setup(true, null, true);
		expect(container.textContent).toContain('This account has a passkey');
		expect(container.textContent).not.toContain('takes a TOTP code');
		expect(getByRole('button', { name: /Set up an authenticator app/ })).toBeTruthy();
		expect(container.querySelector('form[action="?/setup"]')).not.toBeNull();
		expect(container.querySelector('form[action="?/disable"]')).not.toBeNull();
	});
});

describe('setting up an app beside a passkey', () => {
	// The engine holds the new key apart until a code from it verifies, and
	// replacing an app already set up takes a code from it or a backup code.
	it('says the new key replaces an app already set up once a code verifies', () => {
		const { container } = setup(true, null, true);
		const text = container.querySelector('form[action="?/setup"]')?.textContent ?? '';
		expect(text).toContain('If one is already set up, the new key replaces it once you verify a code.');
		expect(text).not.toContain('Starting setup replaces');
	});

	// The status cannot say whether an app is set up beside a passkey, so the
	// code is asked for and left optional.
	it('asks for an optional code that proves an app already set up', () => {
		const { container, getByRole } = setup(true, null, true);
		expect(container.querySelector('form[action="?/setup"] input[name="code"]')).not.toBeNull();
		expect((getByRole('button', { name: /Set up an authenticator app/ }) as HTMLButtonElement).disabled).toBe(false);
	});
});

// Backup codes are hexadecimal, so a field that takes one must not bring up a
// number pad on a phone.
describe('fields that take a backup code', () => {
	it('keep the full keyboard on every form that accepts one', () => {
		for (const hasPasskeys of [false, true]) {
			const { container } = setup(true, null, hasPasskeys);
			const fields = container.querySelectorAll('form[action="?/disable"] input[name="code"], form[action="?/setup"] input[name="code"]');
			expect(fields).toHaveLength(2);
			for (const f of fields) expect(f.getAttribute('inputmode')).toBeNull();
			cleanup();
		}
	});
});

describe('replacing the authenticator app', () => {
	it('asks for a current code or a backup code before setup starts', async () => {
		const { container, getByRole } = setup(true);
		const input = container.querySelector('form[action="?/setup"] input[name="code"]') as HTMLInputElement;
		expect(input).not.toBeNull();
		const button = getByRole('button', { name: /Replace the authenticator app/ }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		await fireEvent.input(input, { target: { value: 'a1b2c3d4' } });
		expect(button.disabled).toBe(false);
	});

	it('shows the refusal the setup action answered', () => {
		const error = 'That code matches neither the authenticator app already set up nor an unused backup code.';
		const { getByText } = setup(true, { step: 'idle', error });
		expect(getByText(error)).toBeTruthy();
	});
});

describe('two-factor authentication page', () => {
	it('offers to turn it on through the setup action', () => {
		const { container, getByRole } = setup(false);
		expect(getByRole('button', { name: /Turn on two-factor authentication/ })).toBeTruthy();
		expect(container.querySelector('form[action="?/setup"]')).not.toBeNull();
	});

	it('carries the generated key through a wrong code', () => {
		const { container, getByText } = setup(false, { step: 'confirming', uri: 'otpauth://x', secret: 'ABC', error: 'invalid code' });
		expect(getByText('invalid code')).toBeTruthy();
		expect((container.querySelector('input[name="secret"]') as HTMLInputElement).value).toBe('ABC');
		expect(container.querySelector('form[action="?/verify"]')).not.toBeNull();
	});

	it('draws the QR code for the generated key in the browser', async () => {
		const { container } = setup(false, { step: 'confirming', uri: 'otpauth://x', secret: 'ABC' });
		await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA'));
	});

	it('shows the backup codes once, after the code is accepted', () => {
		const { getByText } = setup(false, { step: 'done', backupCodes: ['a1', 'b2'] });
		expect(getByText('a1')).toBeTruthy();
		expect(getByText(/not shown again/)).toBeTruthy();
	});

	it('says the state could not be read instead of offering to turn it on', () => {
		const { container, queryByRole } = setup({ ok: false, gate: { state: 'unavailable' } });
		expect(container.textContent).toContain('could not be read');
		expect(container.textContent).not.toContain('is off for this account');
		expect(queryByRole('button', { name: /Turn on/ })).toBeNull();
		expect(queryByRole('button', { name: /Turn off/ })).toBeNull();
	});

	it('asks for a code to turn it off when it is on', () => {
		const { container } = setup(true);
		expect(container.querySelector('form[action="?/disable"] input[name="code"]')).not.toBeNull();
	});

	it('copies every backup code at once and confirms for a second and a half', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn(async (_text: string) => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const { getByRole } = setup(false, { step: 'done', backupCodes: ['a1', 'b2'] });
		const copy = getByRole('button', { name: 'Copy all codes' });
		const status = copy.parentElement!.querySelector('[role="status"]')!;

		await fireEvent.click(copy);
		await vi.advanceTimersByTimeAsync(0);
		expect(writeText).toHaveBeenCalledWith('a1\nb2');
		expect(status.textContent).toBe('Copied');

		await vi.advanceTimersByTimeAsync(1500);
		expect(status.textContent).toBe('');
	});

	it('keeps the advice to write the codes down after a copy fails', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn(async (_text: string) => {
			throw new Error('denied');
		});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true });
		const { getByRole, getByText, queryByText } = setup(false, { step: 'done', backupCodes: ['a1', 'b2'] });

		await fireEvent.click(getByRole('button', { name: 'Copy all codes' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(getByText('Copy failed')).toBeTruthy();

		await vi.advanceTimersByTimeAsync(1500);
		expect(queryByText('Copy failed')).toBeNull();
		expect(getByText(/If the copy fails, write them down before you leave this page\./)).toBeTruthy();
	});
});
