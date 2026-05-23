// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProvidersPage from './+page.svelte';
import type { EmailProvider } from '$lib/api/email';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const smtp: EmailProvider = {
	id: 'p1',
	name: 'Primary',
	transport: 'smtp',
	host: 'smtp.example.test',
	port: 587,
	username: 'mailer',
	from_addr: 'noreply@example.test',
	use_tls: true,
	priority: 0,
	max_per_hour: 0,
	status: 'active',
};

const api: EmailProvider = {
	...smtp,
	id: 'p2',
	name: 'Mailgun',
	transport: 'api',
	host: '',
	port: 0,
	username: undefined,
	api_base_url: 'https://api.mailgun.net',
	api_method: 'POST',
	api_path: '/v3/example.test/messages',
	api_headers: { Authorization: 'Basic {{api_key}}' },
	api_body: '{"from": "{{from}}"}',
	api_message_id_path: 'id',
	api_webhook_event_path: 'event-data.event',
	api_webhook_recipient_path: 'event-data.recipient',
	api_webhook_message_id_path: 'event-data.message.headers.message-id',
	api_webhook_reason_path: 'event-data.delivery-status.message',
	api_webhook_event_map: { delivered: 'delivered', failed: 'bounced_hard' },
	priority: 1,
	status: 'degraded',
};

function setup(providers: EmailProvider[] = [smtp, api], overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(ProvidersPage, {
		props: { data: { unavailable: false, providers, ...overrides }, form } as never,
	});
}

function formEl(container: HTMLElement): HTMLFormElement {
	return container.querySelector('#provider-form') as HTMLFormElement;
}

function names(form: HTMLFormElement): string[] {
	return [...form.querySelectorAll('[name]')].map((el) => el.getAttribute('name') ?? '');
}

const API_FIELDS = [
	'api_key',
	'api_base_url',
	'webhook_secret',
	'api_method',
	'api_path',
	'api_body',
	'api_message_id_path',
	'api_webhook_event_path',
	'api_webhook_recipient_path',
	'api_webhook_message_id_path',
	'api_webhook_reason_path',
];

async function chooseTransport(container: HTMLElement, label: string) {
	await fireEvent.click(container.querySelector('#ep-transport') as HTMLElement);
	await fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === label) as HTMLElement);
}

describe('email providers page', () => {
	it('says the plugin did not answer, and offers nothing to create', () => {
		const { getByText, queryByText } = setup([], { unavailable: true });
		expect(getByText('The email plugin did not answer')).toBeTruthy();
		expect(queryByText('New provider')).toBeNull();
	});

	it('lists transport, endpoint and the webhook path per row and never a key', () => {
		const { container } = setup();
		expect(container.textContent).toContain('Beta');
		const rows = [...container.querySelectorAll('tbody tr')];
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('SMTP');
		expect(rows[0].textContent).toContain('smtp.example.test');
		expect(rows[0].textContent).not.toContain('/api/v1/email/webhook');
		expect(rows[1].textContent).toContain('API');
		expect(rows[1].textContent).toContain('https://api.mailgun.net');
		expect(rows[1].textContent).toContain('/api/v1/email/webhook/api/p2');
		expect(rows[1].textContent).toContain('degraded');
		expect(container.textContent).not.toMatch(/api_key|password|secret/i);
	});

	it('opens a new row on smtp with the server fields and no api fields', async () => {
		const { getAllByText, container } = setup([]);
		await fireEvent.click(getAllByText('New provider')[0]);
		const form = formEl(container);
		expect(form.getAttribute('action')).toBe('?/create');
		expect((form.querySelector('input[name="transport"]') as HTMLInputElement).value).toBe('smtp');
		expect(names(form)).toEqual(expect.arrayContaining(['host', 'port', 'username', 'password', 'use_tls']));
		expect((form.querySelector('[name="port"]') as HTMLInputElement).value).toBe('587');
		for (const name of API_FIELDS) expect(form.querySelector(`[name="${name}"]`), name).toBeNull();
	});

	it('switches to the api fields, asks for the key and names the placeholders', async () => {
		const { getAllByText, container } = setup([]);
		await fireEvent.click(getAllByText('New provider')[0]);
		await chooseTransport(container, 'Provider API');
		const form = formEl(container);
		expect((form.querySelector('input[name="transport"]') as HTMLInputElement).value).toBe('api');
		expect(form.querySelector('[name="host"]')).toBeNull();
		expect(form.querySelector('[name="password"]')).toBeNull();
		expect(names(form)).toEqual(expect.arrayContaining(API_FIELDS));
		const key = form.querySelector('[name="api_key"]') as HTMLInputElement;
		expect(key.type).toBe('password');
		expect(key.required).toBe(true);
		expect(key.value).toBe('');
		expect((form.querySelector('[name="webhook_secret"]') as HTMLInputElement).type).toBe('password');
		expect((form.querySelector('[name="api_base_url"]') as HTMLInputElement).required).toBe(true);
		expect((form.querySelector('input[name="api_method"]') as HTMLInputElement).value).toBe('POST');
		expect(container.textContent).toContain('{{api_key}}');
		expect(container.textContent).toContain('{{basic:<user>}}');
		expect(container.textContent).toContain('{{to_first}}');
		expect(container.textContent).toContain('{{to_objects}}');
		expect(container.textContent).toContain('{{message_id}}');
		await fireEvent.click(container.querySelector('#ep-api-method') as HTMLElement);
		expect([...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim())).toEqual(['POST', 'PUT', 'PATCH']);
		await fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === 'PUT') as HTMLElement);
		expect((form.querySelector('input[name="api_method"]') as HTMLInputElement).value).toBe('PUT');

		await chooseTransport(container, 'SMTP');
		expect(form.querySelector('[name="api_key"]')).toBeNull();
		expect(form.querySelector('[name="host"]')).toBeTruthy();
	});

	it('edits an api row with the key blank and kept, the maps as rows and the webhook path named', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit Mailgun'));
		const form = formEl(container);
		expect(form.getAttribute('action')).toBe('?/update');
		expect((form.querySelector('[name="stored_transport"]') as HTMLInputElement).value).toBe('api');
		const key = form.querySelector('[name="api_key"]') as HTMLInputElement;
		expect(key.value).toBe('');
		expect(key.required).toBe(false);
		expect(container.textContent).toContain('Leave blank to keep it');
		expect(container.textContent).toContain('/api/v1/email/webhook/api/p2');
		expect((form.querySelector('[name="api_base_url"]') as HTMLInputElement).value).toBe('https://api.mailgun.net');
		expect([...form.querySelectorAll('[name="api_header_key"]')].map((el) => (el as HTMLInputElement).value)).toEqual(['Authorization']);
		expect([...form.querySelectorAll('[name="api_header_value"]')].map((el) => (el as HTMLInputElement).value)).toEqual(['Basic {{api_key}}']);
		expect([...form.querySelectorAll('[name="event_map_key"]')].map((el) => (el as HTMLInputElement).value)).toEqual(['delivered', 'failed']);
		expect([...form.querySelectorAll('input[name="event_map_value"]')].map((el) => (el as HTMLInputElement).value)).toEqual(['delivered', 'bounced_hard']);
		expect((form.querySelector('[name="api_body"]') as HTMLTextAreaElement).value).toBe('{"from": "{{from}}"}');
		expect((form.querySelector('[name="api_webhook_reason_path"]') as HTMLInputElement).value).toBe('event-data.delivery-status.message');
	});

	it('edits an smtp row with the password blank and kept, and asks for a key on a transport change', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit Primary'));
		const form = formEl(container);
		expect((form.querySelector('[name="host"]') as HTMLInputElement).value).toBe('smtp.example.test');
		const pw = form.querySelector('[name="password"]') as HTMLInputElement;
		expect(pw.type).toBe('password');
		expect(pw.value).toBe('');
		expect((form.querySelector('input[name="use_tls"]') as HTMLInputElement).value).toBe('true');
		expect(container.textContent).toContain('Leave blank to keep it');

		await chooseTransport(container, 'Provider API');
		expect((form.querySelector('[name="api_key"]') as HTMLInputElement).required).toBe(true);
		expect(container.textContent).toContain('transport changed');
	});

	it('reports a refusal', () => {
		const { getByText } = setup([smtp], {}, { error: 'An API key is required.' });
		expect(getByText('An API key is required.')).toBeTruthy();
	});
});

// The fallback transport has to render even where the pool above it cannot,
// because the reset and sign-in mailers read these settings directly when no
// provider can send.
describe('email page fallback transport', () => {
	const mail = [
		{ key: 'SMTP_HOST', source: 'default', editable: true },
		{ key: 'SMTP_PASS', source: 'env', editable: false, secret: true },
	];

	it('keeps the engine mail settings, editable or pinned', () => {
		const { container } = setup([smtp], { mail });
		expect(container.querySelector('#set-SMTP_HOST')).toBeTruthy();
		expect(container.textContent).toContain('Stored, not shown.');
	});

	it('shows it when the provider pool did not answer', () => {
		const { container } = setup([], { unavailable: true, mail });
		expect(container.querySelector('#set-SMTP_HOST')).toBeTruthy();
		expect(container.textContent).toContain('Fallback transport');
	});

	it('says which of the two sends, so neither reads as the other', () => {
		// Normalized: the copy wraps, and textContent keeps the newline and the
		// indent, so a phrase that spans two source lines never matches raw.
		const text = (setup([smtp], { mail }).container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('Provider pool');
		expect(text).toContain('tried first');
		expect(text).toContain('takes effect at the next restart');
	});

	it('leaves the section out for a session that may not read it', () => {
		const { container } = setup([smtp], { mail: null });
		expect(container.querySelector('#set-SMTP_HOST')).toBeNull();
		expect(container.textContent).not.toContain('Fallback transport');
	});
});
