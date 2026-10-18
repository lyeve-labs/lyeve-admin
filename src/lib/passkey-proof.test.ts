import { describe, expect, it } from 'vitest';
import { fromBase64url, passkeyFailure, PasskeyUnavailable, requestOptions, toBase64url } from './passkey-proof';

describe('passkey proof encoding', () => {
	it('reads and writes base64url without padding', () => {
		const bytes = new Uint8Array([251, 255, 0, 1]);
		expect(toBase64url(bytes.buffer)).toBe('-_8AAQ');
		expect(new Uint8Array(fromBase64url('-_8AAQ'))).toEqual(bytes);
	});

	it('turns the engine options into the browser request', () => {
		const opts = requestOptions({
			publicKey: { challenge: 'AAEC', rpId: 'example.test', allowCredentials: [{ type: 'public-key', id: 'BAUG' }] },
		});
		expect(new Uint8Array(opts.challenge as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 2]));
		expect(opts.rpId).toBe('example.test');
		expect(new Uint8Array(opts.allowCredentials![0].id as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6]));
	});
});

describe('passkey failures', () => {
	it('names each failure in the console words', () => {
		expect(passkeyFailure(new PasskeyUnavailable())).toBe('This browser cannot use a passkey. Enter a code instead.');
		expect(passkeyFailure(new DOMException('x', 'NotAllowedError'))).toMatch(/did not answer/);
		expect(passkeyFailure(new Error('boom'))).toBe('The passkey could not be used. Try again, or enter a code instead.');
	});
});
