// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CaptchaWidget from './CaptchaWidget.svelte';

type Opts = { sitekey: string; callback: (t: string) => void; 'expired-callback': () => void };

// The provider script is the network boundary here. jsdom never loads it, so
// each test plays its load event and installs the global the script would.
function fireScriptLoad(src: RegExp) {
	const el = [...document.head.querySelectorAll('script')].find((s) => src.test(s.src));
	expect(el).toBeTruthy();
	el!.dispatchEvent(new Event('load'));
}

afterEach(() => {
	cleanup();
	document.head.querySelectorAll('script').forEach((s) => s.remove());
	const w = window as unknown as Record<string, unknown>;
	delete w.turnstile;
	delete w.hcaptcha;
	delete w.grecaptcha;
});

describe('CaptchaWidget', () => {
	it('renders Turnstile with the site key and posts the token it issues', async () => {
		let opts: Opts | undefined;
		(window as unknown as Record<string, unknown>).turnstile = {
			render: vi.fn((_el: HTMLElement, o: Opts) => {
				opts = o;
				return 'w1';
			}),
			remove: vi.fn(),
		};
		const { container } = render(CaptchaWidget, {
			props: { challenge: { provider: 'turnstile', siteKey: '0x4AAA' } },
		});

		fireScriptLoad(/challenges\.cloudflare\.com\/turnstile/);
		await waitFor(() => expect(opts?.sitekey).toBe('0x4AAA'));

		const hidden = container.querySelector('input[name="captcha_token"]') as HTMLInputElement;
		expect(hidden.value).toBe('');
		opts!.callback('tok-123');
		await waitFor(() => expect(hidden.value).toBe('tok-123'));

		opts!['expired-callback']();
		await waitFor(() => expect(hidden.value).toBe(''));
	});

	it('renders hCaptcha from its own script', async () => {
		const renderFn = vi.fn(() => 'h1');
		(window as unknown as Record<string, unknown>).hcaptcha = { render: renderFn };
		render(CaptchaWidget, { props: { challenge: { provider: 'hcaptcha', siteKey: 'hk' } } });

		fireScriptLoad(/js\.hcaptcha\.com/);
		await waitFor(() => expect(renderFn).toHaveBeenCalledOnce());
	});

	it('asks reCAPTCHA v3 for a login token with no visible widget', async () => {
		const execute = vi.fn(async () => 'g-token');
		(window as unknown as Record<string, unknown>).grecaptcha = { ready: (fn: () => void) => fn(), execute };
		const { container } = render(CaptchaWidget, {
			props: { challenge: { provider: 'recaptcha', siteKey: '6Lk' } },
		});

		fireScriptLoad(/recaptcha\/api\.js\?render=6Lk/);
		const hidden = container.querySelector('input[name="captcha_token"]') as HTMLInputElement;
		await waitFor(() => expect(hidden.value).toBe('g-token'));
		expect(execute).toHaveBeenCalledWith('6Lk', { action: 'login' });
	});

	it('says so when the provider script cannot load', async () => {
		// A site key no earlier test used, so the URL has no cached load behind it.
		const { container } = render(CaptchaWidget, {
			props: { challenge: { provider: 'recaptcha', siteKey: 'unreachable' } },
		});
		const el = document.head.querySelector('script[src*="unreachable"]') as HTMLScriptElement;
		el.dispatchEvent(new Event('error'));

		await waitFor(() => expect(container.textContent).toMatch(/could not load/i));
	});
});
