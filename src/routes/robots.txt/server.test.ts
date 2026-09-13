import { describe, it, expect } from 'vitest';
import { GET } from './+server';

describe('robots.txt', () => {
	it('disallows every path for every crawler', async () => {
		const res = await GET({} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('text/plain');
		expect(await res.text()).toBe('User-agent: *\nDisallow: /\n');
	});
});
