// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/observability/errors') } }));

import ErrorsPage from './+page.svelte';
import type { ErrorAlert } from '$lib/api/error-tracking';

afterEach(cleanup);

function alert(over: Partial<ErrorAlert> = {}): ErrorAlert {
	return {
		id: 'a1',
		fingerprint: 'fp',
		error_code_id: 'c1',
		source_file: 'store.go',
		source_line: 12,
		message_sample: 'connection refused',
		error_count: 3,
		first_seen: '2026-09-01T00:00:00Z',
		last_seen: '2026-09-02T00:00:00Z',
		acknowledged: true,
		acknowledged_by: 'ana',
		created_at: '2026-09-01T00:00:00Z',
		status: 'open',
		assigned_to: '',
		...over,
	};
}

function setup(over: Record<string, unknown> = {}) {
	return render(ErrorsPage, {
		props: {
			data: {
				alerts: [alert()],
				codes: [],
				total: 1,
				limit: 50,
				offset: 0,
				gate: { state: 'ok' },
				status: '',
				events: { data: [], total: 0, hiddenOlder: 0, windowDays: null },
				...over,
			},
			form: null,
		} as never,
	});
}

function actionsOf(row: Element): string[] {
	return [...row.querySelectorAll('input[name="action"]')].map((i) => (i as HTMLInputElement).value);
}

describe('failure triage', () => {
	it('offers resolve and ignore on an open failure', () => {
		const { container } = setup();
		expect(actionsOf(container.querySelector('[data-testid="failure-row"]')!)).toEqual(['resolve', 'ignore']);
	});

	it.each(['resolved', 'ignored'])('offers reopen on a %s failure', (status) => {
		const { container } = setup({ alerts: [alert({ status })] });
		const row = container.querySelector('[data-testid="failure-row"]')!;
		expect(row.getAttribute('data-status')).toBe(status);
		expect(actionsOf(row)).toEqual(['reopen']);
	});

	it('reads a failure from a plugin without triage as open', () => {
		const { container } = setup({ alerts: [alert({ status: undefined })] });
		expect(container.querySelector('[data-testid="failure-row"]')?.getAttribute('data-status')).toBe('open');
	});

	it('names who a failure is assigned to', () => {
		const { container } = setup({ alerts: [alert({ assigned_to: 'ana@example.com' })] });
		expect(container.querySelector('[data-testid="assignee"]')?.textContent).toContain('ana@example.com');
	});

	it('assigns in a one-field prompt that starts from the current assignee', async () => {
		const { container, getByRole } = setup({ alerts: [alert({ assigned_to: 'ana' })] });
		await fireEvent.click(getByRole('button', { name: 'Assign this failure' }));
		const dialog = container.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;
		expect((dialog.querySelector('#alert-assignee') as HTMLInputElement).value).toBe('ana');
	});
});

describe('recent events', () => {
	it('ends the list with the older events the plugin left out', () => {
		const { container } = setup({ events: { data: [], total: 0, hiddenOlder: 12, windowDays: 30 } });
		const row = container.querySelector('[data-testid="older-hidden"]')?.textContent ?? '';
		expect(row).toContain('12 older events');
		expect(row).toContain('the last 30 days');
	});

	it('shows no such row when nothing was left out', () => {
		const { container } = setup();
		expect(container.querySelector('[data-testid="older-hidden"]')).toBeNull();
	});

	it('says a failed read failed', () => {
		const { container } = setup({ events: null });
		expect(container.textContent).toContain('could not be read');
	});
});
