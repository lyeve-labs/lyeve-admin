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

function setup(mfaEnabled: boolean | { ok: false; gate: unknown }, form: unknown = null) {
	const mfa = typeof mfaEnabled === 'boolean' ? { ok: true, value: mfaEnabled } : mfaEnabled;
	return render(Page, { props: { data: { mfa, entitlements: licensed }, form } as never });
}

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
