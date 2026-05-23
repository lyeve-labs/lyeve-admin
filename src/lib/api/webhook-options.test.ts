import { describe, expect, it } from 'vitest';
import { filtersText, keptJSON, parseFilters, webhookBodyFrom } from './webhook-options';

function form(fields: Record<string, string | string[]>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) f.append(k, one);
	return f;
}

describe('webhookBodyFrom', () => {
	it('sends a plain endpoint with no options', () => {
		const r = webhookBodyFrom(form({ name: 'n', url: 'https://x.example.com', events: ['after_create'], enabled: 'true' }));
		expect(r).toEqual({
			body: { name: 'n', url: 'https://x.example.com', events: ['after_create'], schemas: [], enabled: true },
		});
	});

	it('leaves a blank secret out so an edit keeps the stored one', () => {
		for (const secret of ['', '   ']) {
			const r = webhookBodyFrom(form({ name: 'n', url: 'u', secret, kept: keptJSON({ headers: { 'X-A': '1' } } as never) }));
			expect('body' in r && 'secret' in r.body).toBe(false);
		}
		const none = webhookBodyFrom(form({ name: 'n', url: 'u' }));
		expect('body' in none && 'secret' in none.body).toBe(false);
	});

	it('sends a secret the form names', () => {
		const r = webhookBodyFrom(form({ name: 'n', url: 'u', secret: 'a-new-secret-of-16-chars' }));
		expect('body' in r && r.body.secret).toBe('a-new-secret-of-16-chars');
	});

	it('carries the options the form shows and the settings it keeps', () => {
		const r = webhookBodyFrom(
			form({
				name: 'n',
				url: 'u',
				payload_template: '{"id":"{{.ID}}"}',
				jsonpath_filter: '$.status',
				field_filters: 'status=published\nlocale = en',
				max_retries: '5',
				retry_delay_seconds: '30',
				kept: keptJSON({ headers: { 'X-A': '1' }, max_response_size: 2048 } as never),
			}),
		);
		expect('body' in r && r.body).toMatchObject({
			payload_template: '{"id":"{{.ID}}"}',
			jsonpath_filter: '$.status',
			field_filters: { status: 'published', locale: 'en' },
			max_retries: 5,
			retry_delay_seconds: 30,
			headers: { 'X-A': '1' },
			max_response_size: 2048,
		});
	});

	it('names the filter line it cannot read', () => {
		expect(webhookBodyFrom(form({ field_filters: 'nonsense' }))).toEqual({ error: '"nonsense" is not field=value.', field: 'field_filters' });
	});
});

describe('filters', () => {
	it('round-trips through the textarea', () => {
		const text = filtersText({ a: '1', b: '2' });
		expect(parseFilters(text)).toEqual({ filters: { a: '1', b: '2' } });
	});
});
