// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import CaptchaPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const instance = { provider: 'turnstile', site_key: 'inst', enabled: true };

const props = (settings: Record<string, unknown> | null, over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: { gate: { state: 'ok' }, settings, ...over } as never,
	form: form as never,
});

describe('captcha settings', () => {
	it("always says the admin login uses the install's captcha", () => {
		const { container } = render(CaptchaPage, {
			props: props({ source: 'instance', tenant: null, instance, licensed: true }),
		});
		expect(said(container)).toContain("The admin login always uses the install's captcha");
		expect(screen.getByTestId('captcha-source').textContent).toContain("install's Turnstile");
	});

	it('never shows a stored secret and says an empty field keeps it', () => {
		const { container } = render(CaptchaPage, {
			props: props({
				source: 'tenant',
				tenant: { provider: 'hcaptcha', site_key: 'tenant-site', has_secret: true, score_floor: null },
				instance,
				licensed: true,
			}),
		});
		expect(screen.getByTestId('captcha-source').textContent).toContain('hCaptcha with its own keys');
		expect(said(container)).toContain('A secret is stored and is never shown');
		expect((screen.getByLabelText('Secret key') as HTMLInputElement).value).toBe('');
	});

	it('asks for the score floor only for reCAPTCHA', () => {
		render(CaptchaPage, {
			props: props({
				source: 'tenant',
				tenant: { provider: 'recaptcha', site_key: 's', has_secret: true, score_floor: 0.6 },
				instance,
				licensed: true,
			}),
		});
		expect((screen.getByLabelText('Score floor') as HTMLInputElement).value).toBe('0.6');
		cleanup();
		render(CaptchaPage, { props: props({ source: 'instance', tenant: null, instance, licensed: true }) });
		expect(screen.queryByLabelText('Score floor')).toBeNull();
	});

	it('says what an unlicensed install keeps', () => {
		const { container } = render(CaptchaPage, {
			props: props({ source: 'instance', tenant: null, instance, licensed: false }),
		});
		expect(said(container)).toContain('needs a license this install does not hold');
	});

	it('renders a refused save through the refusal notice', () => {
		render(CaptchaPage, {
			props: props(
				{ source: 'instance', tenant: null, instance, licensed: false },
				{},
				{ error: 'x', refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } },
			),
		});
		expect(screen.getByTestId('refusal-notice')).toBeTruthy();
	});

	it('reports a failed read rather than an empty form', () => {
		const { container } = render(CaptchaPage, {
			props: props(null, { gate: { state: 'error', message: 'The captcha settings could not be read.' } }),
		});
		expect(said(container)).toContain('could not be read');
		expect(screen.queryByLabelText('Site key')).toBeNull();
	});
});
