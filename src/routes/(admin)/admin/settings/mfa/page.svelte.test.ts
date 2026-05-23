// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AA') } }));

afterEach(cleanup);

const licensed = { plan: 'example', state: 'active', features: ['mfa'], tenant_quota: 1 };

function setup(mfaEnabled: boolean, form: unknown = null) {
	return render(Page, { props: { data: { mfaEnabled, entitlements: licensed }, form } as never });
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

	it('asks for a code to turn it off when it is on', () => {
		const { container } = setup(true);
		expect(container.querySelector('form[action="?/disable"] input[name="code"]')).not.toBeNull();
	});
});
