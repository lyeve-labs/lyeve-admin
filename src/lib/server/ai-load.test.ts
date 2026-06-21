import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { aiActionError, aiBanner, aiGate } from './ai-load';

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
		expect(aiGate(new ApiError(503, 'ai unavailable'), { cookies: cookies() }, 'providers')).toEqual({ state: 'no_provider' });
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
	it('names each refusal and relays a 4xx reason', () => {
		expect(aiActionError(new ApiError(402, 'x'), 'f')).toContain('not enabled');
		expect(aiActionError(new ApiError(404, 'x'), 'f')).toContain('switched off');
		expect(aiActionError(new ApiError(503, 'x'), 'f')).toContain('provider');
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
