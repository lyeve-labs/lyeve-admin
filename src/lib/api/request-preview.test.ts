import { describe, expect, it } from 'vitest';
import { curlFor, gateSentence, placeholderPath } from './request-preview';
import type { EndpointDoc } from './reference';

const base: EndpointDoc = { method: 'GET', path: '/api/v1/content/{schema}/{id}', summary: 'Get one', auth: 'bearer' };

describe('request preview', () => {
	it('shows path parameters as placeholders nothing parses', () => {
		expect(placeholderPath('/api/v1/content/{schema}/{id}')).toBe('/api/v1/content/<schema>/<id>');
	});

	it('carries the header the gate asks for', () => {
		expect(curlFor(base)).toContain(`-H 'Authorization: Bearer $LYEVE_TOKEN'`);
		expect(curlFor({ ...base, auth: 'cookie' })).toContain(`-b '__Host-sys_session=$SESSION'`);
		expect(curlFor({ ...base, auth: 'none' })).not.toContain('-H');
	});

	it('sends the example body on a write and nothing on a read', () => {
		const post: EndpointDoc = {
			...base,
			method: 'POST',
			path: '/api/v1/content/{schema}',
			requestBody: { description: 'x', example: '{\n  "title": "Hello",\n  "it\'s": true\n}' },
		};
		const c = curlFor(post, { origin: 'https://cms.example.com/' });
		expect(c).toContain(`curl -X POST 'https://cms.example.com/api/v1/content/<schema>'`);
		expect(c).toContain(`-H 'Content-Type: application/json'`);
		expect(c).toContain(`-d '{"title":"Hello","it'\\''s":true}'`);
		expect(curlFor({ ...base, requestBody: post.requestBody })).not.toContain('-d ');
	});

	it('says who may call it', () => {
		expect(gateSentence({ ...base, auth: 'bearer', roles: ['editor', 'admin'] })).toBe(
			'A bearer token from POST /api/v1/auth/token with the editor or admin role.',
		);
		expect(gateSentence({ ...base, auth: 'none' })).toMatch(/^No credentials/);
	});
});
