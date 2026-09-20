import { describe, expect, it } from 'vitest';

import { parseProvider } from './provider-form';

function form(entries: Record<string, string | string[]>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(entries)) {
		for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
	}
	return fd;
}

describe('parseProvider', () => {
	const smtp = { name: 'Primary', transport: 'smtp', from_addr: 'a@b.c', host: 'smtp.example.test', port: '2525', username: 'u', password: 'pw', use_tls: 'true', priority: '1', max_per_hour: '100' };

	it('builds an smtp body and drops a blank password on edit', () => {
		const created = parseProvider(form(smtp), false);
		expect(created).toEqual({ body: { name: 'Primary', transport: 'smtp', from_addr: 'a@b.c', priority: 1, max_per_hour: 100, host: 'smtp.example.test', port: 2525, username: 'u', use_tls: true, password: 'pw' } });
		const edited = parseProvider(form({ ...smtp, password: '' }), true);
		expect('body' in edited && 'password' in edited.body).toBe(false);
	});

	it('refuses an smtp row with no host and any row with no from address', () => {
		expect(parseProvider(form({ ...smtp, host: '' }), false)).toEqual({ error: 'An SMTP host is required.' });
		expect(parseProvider(form({ ...smtp, from_addr: '' }), false)).toEqual({ error: 'A from address is required.' });
	});

	const api = {
		name: 'Mailgun',
		transport: 'api',
		from_addr: 'a@b.c',
		api_key: 'k',
		api_base_url: 'https://api.mailgun.net',
		webhook_secret: 's',
		api_method: 'post',
		api_path: '/v3/example.test/messages',
		api_header_key: ['Authorization', ''],
		api_header_value: ['Basic {{api_key}}', 'ignored'],
		api_body: '{"from": "{{from}}", "to": {{to}}}',
		api_message_id_path: 'id',
		api_webhook_event_path: 'event-data.event',
		api_webhook_recipient_path: 'event-data.recipient',
		api_webhook_message_id_path: 'event-data.message.headers.message-id',
		api_webhook_reason_path: 'event-data.delivery-status.message',
		event_map_key: ['delivered', 'failed'],
		event_map_value: ['delivered', 'bounced_hard'],
		priority: '0',
		max_per_hour: '0',
	};

	it('builds the api body with the template, the header and event maps, and no provider name', () => {
		const parsed = parseProvider(form(api), false);
		expect(parsed).toEqual({
			body: {
				name: 'Mailgun',
				transport: 'api',
				from_addr: 'a@b.c',
				priority: 0,
				max_per_hour: 0,
				api_key: 'k',
				api_base_url: 'https://api.mailgun.net',
				webhook_secret: 's',
				api_method: 'POST',
				api_path: '/v3/example.test/messages',
				api_headers: { Authorization: 'Basic {{api_key}}' },
				api_body: '{"from": "{{from}}", "to": {{to}}}',
				api_message_id_path: 'id',
				api_webhook_event_path: 'event-data.event',
				api_webhook_recipient_path: 'event-data.recipient',
				api_webhook_message_id_path: 'event-data.message.headers.message-id',
				api_webhook_reason_path: 'event-data.delivery-status.message',
				api_webhook_event_map: { delivered: 'delivered', failed: 'bounced_hard' },
			},
		});
		expect('body' in parsed && 'api_provider' in parsed.body).toBe(false);
	});

	it('requires the key and the base URL on a new api row and keeps the key on edit', () => {
		expect(parseProvider(form({ ...api, api_key: '' }), false)).toEqual({ error: 'An API key is required.' });
		expect(parseProvider(form({ ...api, api_base_url: '' }), false)).toEqual({ error: 'An API base URL is required.' });
		const kept = parseProvider(form({ ...api, api_key: '', webhook_secret: '', stored_transport: 'api' }), true);
		expect('body' in kept && !('api_key' in kept.body) && !('webhook_secret' in kept.body)).toBe(true);
		// An smtp row holds no key, so moving it to api needs one typed.
		expect(parseProvider(form({ ...api, api_key: '', stored_transport: 'smtp' }), true)).toEqual({ error: 'An API key is required.' });
	});

	it('refuses a verb the plugin does not send with and a path that is not a path', () => {
		expect(parseProvider(form({ ...api, api_method: 'GET' }), false)).toEqual({ error: 'Method must be POST, PUT or PATCH.' });
		expect(parseProvider(form({ ...api, api_method: '' }), false)).toMatchObject({ body: { api_method: 'POST' } });
		expect(parseProvider(form({ ...api, api_path: 'v3/messages' }), false)).toEqual({ error: 'The path must start with /.' });
		expect(parseProvider(form({ ...api, api_path: '/v3/messages?x=1' }), false)).toMatchObject({ error: expect.stringContaining('no query') });
		expect(parseProvider(form({ ...api, api_path: '' }), false)).toMatchObject({ body: { api_path: '' } });
	});

	it('refuses an event mapped to something the plugin does not classify', () => {
		expect(parseProvider(form({ ...api, event_map_value: ['delivered', 'lost'] }), false)).toMatchObject({ error: expect.stringContaining('"failed" maps to lost') });
	});
});
