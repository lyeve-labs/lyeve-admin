// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import RecommendationsPage from './+page.svelte';
import type { AbStats } from '$lib/api/recommendations';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function stats(over: Partial<AbStats> = {}): AbStats {
	return {
		recommendation_count: 900,
		random_count: 100,
		total_users: 1000,
		recommendation_pct: 90,
		random_pct: 10,
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		stats: stats(),
		gate: { state: 'ok' },
		licensed: true,
		canRecompute: true,
		...over,
	} as never,
	form: form as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, stats: null }),
		});
		expect(said(container)).toContain('Not enabled on this instance');
	});

	it('reports a failed read as a failure, not as nobody bucketed', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ gate: { state: 'error', message: 'The split could not be read.' }, stats: null }),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('Nobody has been bucketed yet');
	});
});

describe('the split', () => {
	// An even split of zero people reads as a working experiment.
	it('says nobody is bucketed rather than drawing a split of none', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ stats: stats({ total_users: 0, recommendation_pct: 0, random_pct: 0 }) }),
		});
		expect(said(container)).toContain('Nobody has been bucketed yet');
	});

	it('explains that the control arm is what the rest is measured against', () => {
		const { container } = render(RecommendationsPage, { props: props() });
		expect(said(container)).toContain('measured against');
	});

	it('warns when the arms are too far apart to be a hash', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ stats: stats({ recommendation_pct: 99, random_pct: 1 }) }),
		});
		expect(said(container)).toContain('a few points of drift is normal');
	});

	it('says nothing about drift on a healthy split', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ stats: stats({ recommendation_pct: 52, random_pct: 48 }) }),
		});
		expect(said(container)).not.toContain('drift is normal');
	});
});

describe('the recompute', () => {
	// A 409 means somebody pressed first. Reporting it in red sends an
	// operator looking for a fault that is not there.
	it('shows an already running recompute as information, not a failure', () => {
		const { container } = render(RecommendationsPage, {
			props: props({}, { error: 'A recompute is already running. Wait for it rather than starting a second.' }),
		});
		expect(said(container)).toContain('already running');
	});

	it('reports what a finished recompute actually did', () => {
		const { container } = render(RecommendationsPage, {
			props: props({}, { refreshed: true, pairs: 120, trending: 30, feeds: 400, ms: 125_000 }),
		});
		const text = said(container);
		expect(text).toContain('2m 5s');
		expect(text).toContain('120 similarity pairs');
	});

	it('hides the recompute from a role that may not run one', () => {
		const { queryByText } = render(RecommendationsPage, {
			props: props({ canRecompute: false }),
		});
		expect(queryByText('Recompute')).toBeNull();
	});
});

describe('the per-reader preview', () => {
	it('marks a control-arm pick apart from a recommendation', () => {
		const { container } = render(RecommendationsPage, {
			props: props(
				{},
				{
					previewFor: 'u1',
					feed: [
						{ id: 'f1', user_id: 'u1', content_id: 'c1', score: 0.91, source: 'similar', created_at: '2026-09-22T10:00:00Z' },
						{ id: 'f2', user_id: 'u1', content_id: 'c2', score: 0, source: 'random', created_at: '2026-09-22T10:00:00Z' },
					],
				},
			),
		});
		const text = said(container);
		expect(text).toContain('Similar to something they read');
		expect(text).toContain('Random, control arm');
	});

	it('says why a reader has an empty feed rather than showing a blank table', () => {
		const { container } = render(RecommendationsPage, {
			props: props({}, { previewFor: 'u1', feed: [] }),
		});
		expect(said(container)).toContain('read nothing yet');
	});

	it('keeps the reader field as tall as its button', () => {
		// The row aligns its items to the bottom, so text under the field would
		// put the button level with that text and below the input it submits.
		const { container } = render(RecommendationsPage, { props: props() });
		const field = container.querySelector('#rec-user')!.closest('[data-field]')!;
		expect(field.lastElementChild!.contains(container.querySelector('#rec-user'))).toBe(true);
		expect(said(container)).toContain('the Users page');
	});
});
