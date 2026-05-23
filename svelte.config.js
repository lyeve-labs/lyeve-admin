import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// The captcha providers' own origins, from each one's published CSP guidance.
const CAPTCHA_SCRIPT_ORIGINS = [
	'https://challenges.cloudflare.com',
	'https://hcaptcha.com',
	'https://*.hcaptcha.com',
	'https://www.google.com/recaptcha/',
	'https://www.gstatic.com/recaptcha/',
];
const CAPTCHA_FRAME_ORIGINS = [
	'https://challenges.cloudflare.com',
	'https://hcaptcha.com',
	'https://*.hcaptcha.com',
	'https://www.google.com/recaptcha/',
	'https://recaptcha.google.com/recaptcha/',
];

/** @type {import('@sveltejs/kit').Config} */
const config = {

  // Throw on an accessibility warning rather than printing one. The
  // application has none, so the gate fires only on a new one.
  //
  // Both spellings are tested. Svelte 5 spells every warning code in
  // snake_case, so a gate written as startsWith('a11y-') would match nothing
  // and reject nothing while still reading as a working gate.
  onwarn: (warning, handler) => {
    if (/^a11y[-_]/.test(warning.code ?? '')) {
      throw new Error(`a11y violation: ${warning.code}: ${warning.message}`);
    }
    handler?.(warning);
  },
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// CSP via SvelteKit so its inline hydration scripts get nonces automatically.
		// Google Fonts (fonts.googleapis.com / fonts.gstatic.com) are allowlisted to
		// match src/app.html. The sign-in challenge loads its widget from whichever
		// provider the captcha plugin is configured for (Turnstile, hCaptcha or
		// reCAPTCHA), so those origins are allowed for scripts and frames. The list
		// matches captchaScriptURL in src/lib/captcha.ts. Everything else is locked
		// to 'self'.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', ...CAPTCHA_SCRIPT_ORIGINS],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com', 'https://hcaptcha.com', 'https://*.hcaptcha.com'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'data:'],
				'connect-src': ['self', 'https://hcaptcha.com', 'https://*.hcaptcha.com'],
				'frame-src': CAPTCHA_FRAME_ORIGINS,
				'frame-ancestors': ['none'],
				'form-action': ['self'],
				'base-uri': ['self'],
				'object-src': ['none']
			}
		}
	},
};

export default config;
