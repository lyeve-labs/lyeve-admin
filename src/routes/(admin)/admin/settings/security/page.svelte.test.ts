// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({ page: { url: new URL('http://admin/admin/settings/security') } }));

import SecurityPage from './+page.svelte';

afterEach(cleanup);

const report = {
	checked_at: '2026-10-01T12:00:00Z',
	failures: 1,
	controls: [
		{ control: 'pii-mask', status: 'PASS', detail: 'rules=3' },
		{ control: 'quota', status: 'SKIP', detail: 'not built in' },
		{ control: 'data-residency', status: 'FAIL', detail: 'middleware missing', remedy: 'Restart with the plugin enabled.' },
		{ control: 'quota/rate-limit', status: 'WARN', detail: 'no limits set', remedy: 'Add a rate limit.' },
	],
};

const page = (data: Record<string, unknown>) => render(SecurityPage, { props: { data } as never });

describe('the security report', () => {
	it('lists failures first, then what is off, then what enforces, then what is not built in', () => {
		const { container } = page({ report: { ok: true, value: report } });
		const names = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
		expect(names.map((t) => ['Data residency', 'Rate limiting', 'PII masking', 'Quotas'].find((n) => t.includes(n)))).toEqual([
			'Data residency',
			'Rate limiting',
			'PII masking',
			'Quotas',
		]);
	});

	it('names each status in words beside its control, and what turns it on', () => {
		const { container } = page({ report: { ok: true, value: report } });
		const failing = [...container.querySelectorAll('li')].find((li) => li.textContent?.includes('Data residency')) as HTMLElement;
		expect(failing.textContent).toContain('Not enforcing');
		expect(failing.textContent).toContain('To turn it on:');
		expect(failing.textContent).toContain('Restart with the plugin enabled.');
	});

	it('warns about a control that is switched on and not enforcing', () => {
		page({ report: { ok: true, value: report } });
		expect(screen.getByText('Configured but not enforcing')).toBeTruthy();
		expect(screen.getByText(/One control is switched on and not in the request path\./)).toBeTruthy();
	});

	it('raises no warning when every control that is on enforces', () => {
		page({ report: { ok: true, value: { ...report, failures: 0, controls: report.controls.slice(0, 2) } } });
		expect(screen.queryByText('Configured but not enforcing')).toBeNull();
	});

	it('says an empty report names no controls', () => {
		page({ report: { ok: true, value: { ...report, failures: 0, controls: [] } } });
		expect(screen.getByText('No controls reported')).toBeTruthy();
	});
});

describe('a report the engine did not give', () => {
	it('says the engine did not answer, rather than drawing an empty report', () => {
		const { container } = page({ report: { ok: false, gate: { state: 'unavailable' } } });
		expect(screen.getByText('Temporarily unavailable')).toBeTruthy();
		expect(container.textContent).not.toContain('No controls reported');
	});

	it('says a busy engine is busy, with a way to try again', () => {
		const { container } = page({ report: { ok: false, gate: { state: 'busy' } } });
		expect(screen.getByText('Too many requests')).toBeTruthy();
		expect(screen.getByRole('link', { name: /try again/i })).toBeTruthy();
		expect(container.textContent).not.toContain('not reachable');
	});

	it('says an engine that serves no report does not report its controls', () => {
		page({ report: { ok: false, gate: { state: 'absent' } } });
		expect(screen.getByText(/This engine does not report its controls/)).toBeTruthy();
	});
});
