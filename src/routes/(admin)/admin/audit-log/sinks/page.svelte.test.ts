// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import SinksPage from './+page.svelte';

afterEach(cleanup);

const sink = {
	id: 's1',
	name: 'Security SIEM',
	kind: 'splunk',
	url: 'https://splunk.example.com/services/collector/event',
	enabled: true,
	has_secret: true,
	cursor_sequence: 10,
	consecutive_failures: 2,
	last_error: 'receiver answered 503',
	last_error_at: '2026-10-02T09:00:00Z',
	pending_entries: 40,
	lag_seconds: 125,
	created_at: '',
	updated_at: '',
};

function setup(data: Record<string, unknown>, form: unknown = null) {
	return render(SinksPage, { props: { data: { gate: { state: 'ok' }, sinks: [], ...data }, form } as never });
}

describe('audit sinks page', () => {
	it('shows how far behind a destination is and its last error', () => {
		const { container, getByTestId } = setup({ sinks: [sink] });
		expect(container.textContent).toContain('40 entries waiting, 2 min behind');
		expect(container.textContent).toContain('2 failed attempts in a row');
		expect(getByTestId('sink-error').textContent).toContain('receiver answered 503');
	});

	it('says nothing receives the log when there is no destination', () => {
		const { container } = setup({});
		expect(container.textContent).toContain('Nothing receives the audit log');
	});

	it('shows a generated secret once, after the create', () => {
		const { container } = setup({ sinks: [sink] }, { created: 'Hook', secret: 'whsec_once' });
		expect(document.body.textContent).toContain('It is not shown again');
		expect(container.textContent).toContain('Hook is streaming the audit log');
	});

	it('renders a refused create as the refusal notice', () => {
		const { getAllByTestId } = setup(
			{ sinks: [sink] },
			{ error: 'x', refused: { kind: 'feature', feature: 'example-capability', plugin: 'example', upgradeUrl: '' } },
		);
		expect(getAllByTestId('refusal-notice')[0].textContent).toContain('example-capability');
	});

	it('says why the page is empty when the plugin is not there', () => {
		const { container } = setup({ gate: { state: 'absent' } });
		expect(container.textContent).toContain('does not stream the audit log');
	});
});
