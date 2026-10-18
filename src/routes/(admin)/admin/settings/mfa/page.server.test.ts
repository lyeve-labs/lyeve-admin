import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

type Reply = { status: number; body: unknown };

/** An event whose engine answers each path with the reply given for it. */
function event(replies: Record<string, Reply>, form: Record<string, string> = {}) {
	const calls: { url: string; body: unknown }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url, 'http://engine').pathname;
		calls.push({ url: path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		const r = replies[path] ?? { status: 404, body: { error: 'not found' } };
		return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
	});
	const body = new FormData();
	for (const [k, v] of Object.entries(form)) body.set(k, v);
	return {
		calls,
		ev: {
			fetch,
			cookies: { get: (name: string) => (name === '__Host-sys_session' ? 'tok' : name === '__Host-csrf' ? 'c' : undefined) },
			request: new Request('http://admin/admin/settings/mfa', { method: 'POST', body }),
		} as never,
	};
}

describe('mfa load', () => {
	it('reads the account state and keeps an unreadable one unknown, never off', async () => {
		const on = event({ '/api/admin/mfa/status': { status: 200, body: { enabled: true, has_passkeys: false, passkeys: [] } } });
		expect(await load(on.ev)).toEqual({ mfa: { ok: true, value: { enabled: true, hasPasskeys: false } } });
		const off = event({ '/api/admin/mfa/status': { status: 200, body: { enabled: false, has_passkeys: false, passkeys: [] } } });
		expect(await load(off.ev)).toEqual({ mfa: { ok: true, value: { enabled: false, hasPasskeys: false } } });
		const down = event({ '/api/admin/mfa/status': { status: 503, body: { error: 'x' } } });
		expect(await load(down.ev)).toEqual({ mfa: { ok: false, gate: { state: 'unavailable' } } });
	});

	// The plugin reports a passkey as two-factor on, and lists it.
	it('keeps a passkey apart from the authenticator app', async () => {
		const passkey = event({
			'/api/admin/mfa/status': {
				status: 200,
				body: {
					enabled: true,
					has_passkeys: true,
					passkeys: [
						{ id: 'a1b2', name: 'Laptop', is_backup: false, created_at: '2026-10-01T09:00:00Z', last_used_at: null },
					],
				},
			},
		});
		expect(await load(passkey.ev)).toEqual({ mfa: { ok: true, value: { enabled: true, hasPasskeys: true } } });
	});
});

describe('mfa disable with no app set up', () => {
	it('says there is no authenticator app to turn off', async () => {
		const { ev } = event({ '/api/admin/mfa/totp/disable': { status: 400, body: { error: 'MFA not enabled' } } }, { code: '123456' });
		const r = (await actions.disable(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('No authenticator app is set up on this account, so there is nothing to turn off.');
	});
});

describe('mfa actions', () => {
	it('moves to the QR step with the key the engine generated', async () => {
		const { ev, calls } = event({ '/api/admin/mfa/totp/setup': { status: 200, body: { provisioning_uri: 'otpauth://x', secret: 'ABC' } } });
		expect(await actions.setup(ev)).toEqual({ step: 'confirming', uri: 'otpauth://x', secret: 'ABC' });
		expect(calls[0].body).toEqual({});
	});
});

describe('mfa setup over an authenticator app already set up', () => {
	const setupPath = '/api/admin/mfa/totp/setup';

	it('sends the code that proves the app already set up', async () => {
		const { ev, calls } = event({ [setupPath]: { status: 200, body: { provisioning_uri: 'otpauth://x', secret: 'ABC' } } }, { code: ' 123456 ' });
		expect(await actions.setup(ev)).toEqual({ step: 'confirming', uri: 'otpauth://x', secret: 'ABC' });
		expect(calls[0].body).toEqual({ code: '123456' });
	});

	it('asks for a code when the engine says one is required', async () => {
		const { ev } = event({ [setupPath]: { status: 400, body: { error: 'engine words', code: 'mfa.totp.current_code_required' } } });
		const r = (await actions.setup(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(400);
		expect(r.data).toEqual({
			step: 'idle',
			error: 'An authenticator app is already set up. Enter a current code from it, or a backup code, to replace it.',
		});
	});

	it('says the code did not match when the engine refuses it', async () => {
		const { ev } = event({ [setupPath]: { status: 422, body: { error: 'engine words', code: 'mfa.totp.current_code_invalid' } } }, { code: '000000' });
		const r = (await actions.setup(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(400);
		expect(r.data).toEqual({
			step: 'idle',
			error: 'That code matches neither the authenticator app already set up nor an unused backup code.',
		});
	});

	it('keeps a server failure body off the page', async () => {
		const { ev } = event({ [setupPath]: { status: 503, body: { error: 'dial tcp: refused', code: 'mfa.totp.current_code_invalid' } } }, { code: '000000' });
		const r = (await actions.setup(ev)) as { data: Record<string, unknown> };
		expect(r.data).toMatchObject({ step: 'idle', error: 'The authenticator key could not be generated.' });
	});
});

describe('mfa verify and disable', () => {

	it('refuses a code that is not six digits before asking the engine', async () => {
		const { ev, calls } = event({}, { code: '12', uri: 'otpauth://x', secret: 'ABC' });
		const r = (await actions.verify(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(400);
		expect(r.data).toMatchObject({ step: 'confirming', secret: 'ABC', error: 'Enter the 6-digit code from the app.' });
		expect(calls).toHaveLength(0);
	});

	it('keeps the same key on a wrong code and says what the engine said', async () => {
		const { ev } = event(
			{ '/api/admin/mfa/totp/verify': { status: 400, body: { error: 'invalid code' } } },
			{ code: '123456', uri: 'otpauth://x', secret: 'ABC' },
		);
		const r = (await actions.verify(ev)) as { data: Record<string, unknown> };
		expect(r.data).toMatchObject({ step: 'confirming', uri: 'otpauth://x', secret: 'ABC', error: 'invalid code' });
	});

	it('hands back the backup codes once the code is accepted', async () => {
		const { ev, calls } = event(
			{ '/api/admin/mfa/totp/verify': { status: 200, body: { backup_codes: ['a1', 'b2'] } } },
			{ code: '123456', uri: 'otpauth://x', secret: 'ABC' },
		);
		expect(await actions.verify(ev)).toEqual({ step: 'done', backupCodes: ['a1', 'b2'] });
		expect(calls[0].body).toEqual({ code: '123456' });
	});

	it('never shows a server failure body', async () => {
		const { ev } = event({ '/api/admin/mfa/totp/disable': { status: 500, body: { error: 'pq: relation missing' } } }, { code: '123456' });
		const r = (await actions.disable(ev)) as { data: Record<string, unknown> };
		expect(r.data.error).toBe('Two-factor authentication could not be turned off.');
	});
});
