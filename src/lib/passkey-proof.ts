/**
 * The browser half of proving a passkey before another factor is added.
 *
 * The engine sends request options with every binary field as base64url, the
 * way its WebAuthn library writes them, and reads the assertion back in the
 * same encoding. The browser API takes and returns ArrayBuffers, so this
 * module converts both ways.
 */

/** The request options the engine's proof begin route answers with. */
export interface ProofOptions {
	publicKey: {
		challenge: string;
		timeout?: number;
		rpId?: string;
		allowCredentials?: { type: string; id: string; transports?: string[] }[];
		userVerification?: UserVerificationRequirement;
	};
}

export function fromBase64url(s: string): ArrayBuffer {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out.buffer;
}

export function toBase64url(buf: ArrayBuffer): string {
	let bin = '';
	for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The engine's options as the browser API takes them. */
export function requestOptions(options: ProofOptions): PublicKeyCredentialRequestOptions {
	const pk = options.publicKey;
	return {
		challenge: fromBase64url(pk.challenge),
		timeout: pk.timeout,
		rpId: pk.rpId,
		userVerification: pk.userVerification,
		allowCredentials: (pk.allowCredentials ?? []).map((c) => ({
			type: 'public-key',
			id: fromBase64url(c.id),
			transports: c.transports as AuthenticatorTransport[] | undefined,
		})),
	};
}

/** The assertion as the engine reads it. */
export function assertionBody(cred: PublicKeyCredential): string {
	const r = cred.response as AuthenticatorAssertionResponse;
	return JSON.stringify({
		id: cred.id,
		rawId: toBase64url(cred.rawId),
		type: cred.type,
		response: {
			clientDataJSON: toBase64url(r.clientDataJSON),
			authenticatorData: toBase64url(r.authenticatorData),
			signature: toBase64url(r.signature),
			userHandle: r.userHandle ? toBase64url(r.userHandle) : undefined,
		},
	});
}

/** Asks the browser for a passkey assertion and returns it as the engine reads it. */
export async function provePasskey(options: ProofOptions): Promise<string> {
	if (typeof navigator === 'undefined' || !navigator.credentials || typeof PublicKeyCredential === 'undefined') {
		throw new PasskeyUnavailable();
	}
	const cred = await navigator.credentials.get({ publicKey: requestOptions(options) });
	if (!cred) throw new DOMException('no credential', 'NotAllowedError');
	return assertionBody(cred as PublicKeyCredential);
}

/** This browser has no WebAuthn. */
export class PasskeyUnavailable extends Error {}

/** The console's sentence for a passkey the browser could not use. */
export function passkeyFailure(e: unknown): string {
	if (e instanceof PasskeyUnavailable) return 'This browser cannot use a passkey. Enter a code instead.';
	if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
		return 'The passkey did not answer, or the request was canceled. Try again, or enter a code instead.';
	}
	return 'The passkey could not be used. Try again, or enter a code instead.';
}
