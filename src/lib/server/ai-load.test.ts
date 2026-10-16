import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { AI_BUDGET_TEXT, aiActionError, aiBanner, aiGate } from './ai-load';

function cookies(): Cookies {
	return { get: vi.fn(), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

describe('aiGate', () => {
	it('sends a 401 to the login page after clearing the session cookie', () => {
		const jar = cookies();
		expect(() => aiGate(new ApiError(401, 'unauthorized'), { cookies: jar }, 'providers')).toThrow(
			expect.objectContaining({ status: 302, location: '/login' })
		);
		expect(jar.delete).toHaveBeenCalledWith('__Host-sys_session', expect.objectContaining({ path: '/' }));
	});

	it('sorts the four refusals into distinct states', () => {
		expect(aiGate(new ApiError(402, 'payment required'), { cookies: cookies() }, 'providers')).toEqual({ state: 'locked' });
		expect(aiGate(new ApiError(403, 'forbidden'), { cookies: cookies() }, 'providers')).toEqual({ state: 'forbidden' });
		expect(aiGate(new ApiError(404, 'AI is switched off for this tenant'), { cookies: cookies() }, 'providers')).toEqual({ state: 'off' });
		expect(aiGate(new ApiError(503, 'no enabled AI provider configured', { error: 'no enabled AI provider configured', code: 'service_unavailable' }), { cookies: cookies() }, 'providers')).toEqual({ state: 'no_provider' });
		// The plugin answers its own store failures with a JSON 503 too, and
		// that is an outage behind the engine, not a missing provider.
		expect(aiGate(new ApiError(503, 'failed to list providers', { error: 'failed to list providers', code: 'service_unavailable' }), { cookies: cookies() }, 'providers')).toMatchObject({ state: 'error' });
		// A 503 page from a proxy in front of the engine is an outage, not a
		// plugin without a provider.
		expect(aiGate(new ApiError(503, '<html>Service Unavailable</html>'), { cookies: cookies() }, 'providers')).toMatchObject({ state: 'error' });
	});

	it('keeps the engine banner for a 5xx, a network failure and a status it does not expect', () => {
		for (const err of [new ApiError(500, 'pq: connection refused'), new TypeError('fetch failed'), new ApiError(418, 'teapot')]) {
			const out = aiGate(err, { cookies: cookies() }, 'transcripts');
			expect(out).toEqual({ state: 'error', message: aiBanner('transcripts') });
			expect(JSON.stringify(out)).not.toContain('pq:');
		}
	});
});

describe('aiActionError', () => {
	it('names the lowest role the route admits on a role refusal', () => {
		const refused = new ApiError(403, 'insufficient permissions', { error: 'insufficient permissions', code: 'forbidden' });
		expect(aiActionError(refused, 'f')).toBe('Your role cannot change this. Ask an admin if you need it.');
		expect(aiActionError(refused, 'f', 'super_admin')).toBe('Your role cannot change this. Ask a super admin if you need it.');
	});

	it('says the budget is spent only when the 402 names the budget', () => {
		const budget = new ApiError(402, 'ai budget exhausted for this billing period', { error: 'ai budget exhausted for this billing period', code: 'http_402' });
		expect(aiActionError(budget, 'f')).toBe(AI_BUDGET_TEXT);
		const other = new ApiError(402, 'this request needs a paid plan', { error: 'this request needs a paid plan', code: 'http_402' });
		expect(aiActionError(other, 'f')).toBe('AI is not enabled on this instance.');
		const ceiling = new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded', cap: 'ai.providers', limit: 2, current: 2, upgrade_url: '' });
		expect(aiActionError(ceiling, 'f')).toBe('AI is not enabled on this instance.');
		const license = new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'ai', feature: 'feature:ai', upgrade_url: '' });
		expect(aiActionError(license, 'f')).toBe('AI is not enabled on this instance.');
	});

	it('names each refusal and relays a 4xx reason', () => {
		expect(aiActionError(new ApiError(402, 'x'), 'f')).toContain('not enabled');
		expect(aiActionError(new ApiError(404, 'x'), 'f')).toContain('switched off');
		expect(aiActionError(new ApiError(503, 'no enabled AI provider configured', { error: 'no enabled AI provider configured' }), 'f')).toContain('provider');
		expect(aiActionError(new ApiError(503, 'failed to list models', { error: 'failed to list models' }), 'f')).toBe('f');
		expect(aiActionError(new ApiError(503, '<html>Service Unavailable</html>'), 'f')).toBe('f');
		expect(aiActionError(new ApiError(409, 'x'), 'f')).toContain('supports');
		expect(aiActionError(new ApiError(400, 'base_url is required for the openai_compatible kind'), 'f')).toBe(
			'base_url is required for the openai_compatible kind'
		);
	});

	it('collapses a 5xx to the fallback so driver text never reaches the page', () => {
		expect(aiActionError(new ApiError(500, 'pq: boom'), 'Failed to save')).toBe('Failed to save');
		expect(aiActionError(new TypeError('fetch failed'), 'Failed to save')).toBe('Failed to save');
	});
});

describe('aiSettingsGate', () => {
	it('reads a 404 on the settings route as a plugin that is not mounted', async () => {
		const { aiSettingsGate } = await import('./ai-load');
		expect(aiSettingsGate(new ApiError(404, 'not found'), { cookies: cookies() })).toEqual({ state: 'absent' });
		expect(aiSettingsGate(new ApiError(402, 'x'), { cookies: cookies() })).toEqual({ state: 'locked' });
	});
});
