/**
 * One request a reader can paste, for every documented endpoint: the method,
 * the path with its parameters left as placeholders, the header the gate
 * asks for, and the example body where the engine documents one. It is a
 * preview, not a client: nothing here is sent anywhere.
 */
import type { EndpointDoc } from './reference';

export interface PreviewOptions {
	/** Where the engine answers, for the pasted line. */
	origin?: string;
}

const DEFAULT_ORIGIN = 'http://localhost:3002';

function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The path with `{name}` parameters shown as `<name>`, which nothing parses. */
export function placeholderPath(path: string): string {
	return path.replace(/\{([^}]+)\}/g, '<$1>');
}

export function curlFor(ep: EndpointDoc, opts: PreviewOptions = {}): string {
	const origin = (opts.origin ?? DEFAULT_ORIGIN).replace(/\/$/, '');
	const lines: string[] = [`curl -X ${ep.method} ${shellQuote(origin + placeholderPath(ep.path))}`];
	switch (ep.auth) {
		case 'bearer':
		case 'bearer-or-cookie':
			lines.push(`-H 'Authorization: Bearer $LYEVE_TOKEN'`);
			break;
		case 'cookie':
			lines.push(`-b '__Host-sys_session=$SESSION'`);
			break;
		case 'none':
			break;
	}
	if (ep.requestBody?.example && (ep.method === 'POST' || ep.method === 'PUT')) {
		lines.push(`-H 'Content-Type: application/json'`);
		let body = ep.requestBody.example;
		try {
			body = JSON.stringify(JSON.parse(body));
		} catch {
			// Not JSON: the example goes as written.
		}
		lines.push(`-d ${shellQuote(body)}`);
	}
	return lines.join(' \\\n  ');
}

/** What the gate in front of this endpoint asks for, in one sentence. */
export function gateSentence(ep: EndpointDoc): string {
	const who = ep.roles?.length ? ` with the ${ep.roles.join(' or ')} role` : '';
	switch (ep.auth) {
		case 'none':
			return 'No credentials. Anyone who can reach the engine can call it.';
		case 'bearer':
			return `A bearer token from POST /api/v1/auth/token${who}.`;
		case 'cookie':
			return `The admin session cookie${who}.`;
		case 'bearer-or-cookie':
			return `A bearer token or the admin session cookie${who}.`;
	}
}
