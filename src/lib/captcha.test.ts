import { describe, expect, it } from 'vitest';
import { captchaScriptURL, challengeFrom } from './captcha';

describe('challengeFrom', () => {
	it('reads the provider and site key the engine sent', () => {
		expect(
			challengeFrom({ captcha_required: true, captcha_site_key: 'k', captcha_provider: 'hcaptcha' })
		).toEqual({ provider: 'hcaptcha', siteKey: 'k' });
	});

	it('falls back to Turnstile when the body names no provider', () => {
		expect(challengeFrom({ captcha_required: true, captcha_site_key: 'k' })).toEqual({
			provider: 'turnstile',
			siteKey: 'k',
		});
	});

	it.each([
		['no body', undefined],
		['a plain refusal', { error: 'invalid credentials' }],
		['no site key', { captcha_required: true, captcha_site_key: '' }],
		['a provider the console cannot render', { captcha_required: true, captcha_site_key: 'k', captcha_provider: 'friendly' }],
		['a flag that is not true', { captcha_required: 'yes', captcha_site_key: 'k' }],
	])('is null for %s', (_label, body) => {
		expect(challengeFrom(body)).toBeNull();
	});
});

describe('captchaScriptURL', () => {
	it('renders Turnstile and hCaptcha explicitly into the page', () => {
		expect(captchaScriptURL({ provider: 'turnstile', siteKey: 'k' })).toContain('render=explicit');
		expect(captchaScriptURL({ provider: 'hcaptcha', siteKey: 'k' })).toContain('render=explicit');
	});

	it('keys reCAPTCHA by its site key', () => {
		expect(captchaScriptURL({ provider: 'recaptcha', siteKey: '6L&x' })).toBe(
			'https://www.google.com/recaptcha/api.js?render=6L%26x'
		);
	});
});
