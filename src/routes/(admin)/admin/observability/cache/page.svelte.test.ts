// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import CachePage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const rule = {
	id: 'r1',
	pattern: '/api/v1/content/posts/**',
	ttl_seconds: 3600,
	tags: ['posts'],
	enabled: true,
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		superAdmin: false,
		stats: null,
		providers: [{ name: 'memory-0', kind: 'memory', priority: 0, enabled: true }],
		providersRead: true,
		providersLicensed: false,
		inactive: [],
		rules: { gate: { state: 'ok' }, rows: [rule], licensed: false, limit: { limit: 10, current: 1 } },
		entries: [],
		total: 0,
		limit: 50,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		...over,
	} as never,
	form: form as never,
});

describe('providers', () => {
	it('says an install without the license runs one provider and lists each one left out with its reason', () => {
		const { container } = render(CachePage, {
			props: props({ inactive: [{ name: 'redis-1', kind: 'redis', priority: 1, reason: 'provider_limit' }] }),
		});
		expect(screen.getByTestId('provider-tier').textContent).toContain('runs one provider');
		expect(said(container)).toContain('redis-1');
		expect(said(container)).toContain('Left out: this install runs one provider');
	});

	it('says every provider runs with failover when the install is licensed for it', () => {
		render(CachePage, { props: props({ providersLicensed: true }) });
		expect(screen.getByTestId('provider-tier').textContent).toContain('with failover');
	});

	it('names a networked provider the engine cannot run', () => {
		const { container } = render(CachePage, {
			props: props({ inactive: [{ name: 'redis-0', kind: 'redis', priority: 0, reason: 'networked_unavailable' }] }),
		});
		expect(said(container)).toContain('does not run networked cache providers');
	});
});

describe('response cache rules', () => {
	it('counts the rules against the ceiling the plugin stated', () => {
		const { container } = render(CachePage, { props: props() });
		expect(said(container)).toContain('1 of 10 rules');
		expect(said(container)).toContain('/api/v1/content/posts/**');
		expect(said(container)).toContain('1 h');
	});

	it('warns at the ceiling with the stated numbers', () => {
		const { container } = render(CachePage, {
			props: props({
				rules: { gate: { state: 'ok' }, rows: [rule], licensed: false, limit: { limit: 10, current: 10 } },
			}),
		});
		expect(said(container)).toContain('10 of 10 rules');
		expect(said(container)).toContain('Every rule this install allows is in use');
	});

	it('shows the count alone when the install holds no ceiling', () => {
		const { container } = render(CachePage, {
			props: props({
				rules: { gate: { state: 'ok' }, rows: [rule], licensed: true, limit: { limit: null, current: 1 } },
			}),
		});
		expect(said(container)).toContain('1 rule');
		expect(said(container)).not.toContain('of 10');
	});

	it('shows the empty state when no rule exists', () => {
		const { container } = render(CachePage, {
			props: props({ rules: { gate: { state: 'ok' }, rows: [], licensed: false, limit: { limit: 10, current: 0 } } }),
		});
		expect(said(container)).toContain('No response is cached by rule');
		expect(said(container)).toContain('0 of 10 rules');
	});

	it('reports a failed rules read as a failure, not as no rules', () => {
		const { container } = render(CachePage, {
			props: props({ rules: { gate: { state: 'error', message: 'The rules could not be read.' }, rows: [], licensed: null } }),
		});
		expect(said(container)).toContain('The rules could not be read.');
		expect(said(container)).not.toContain('No response is cached by rule');
	});

	it('renders a ceiling refusal from the action through the refusal notice', () => {
		render(CachePage, {
			props: props({}, { error: 'x', refused: { kind: 'cap', cap: 'example.rules', limit: 10, current: 10, upgradeUrl: '' } }),
		});
		expect(screen.getAllByTestId('refusal-notice')[0].textContent).toContain('10 of 10 rules are in use');
	});

	it('offers purge by rule, by tag and for everything', () => {
		render(CachePage, { props: props() });
		expect(screen.getByRole('button', { name: 'Purge /api/v1/content/posts/**' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /Purge all/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Purge tag' })).toBeTruthy();
	});

	it('keeps the instance flush off a tenant admin page', () => {
		const { container } = render(CachePage, { props: props() });
		expect(said(container)).not.toContain('Flush everything');
	});
});
