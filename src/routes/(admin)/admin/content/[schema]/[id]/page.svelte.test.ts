// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/content/article/e1') } }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import EntryPage from './+page.svelte';

afterEach(cleanup);

function data(overrides: Record<string, unknown> = {}): PageData {
	return {
		schemaDef: {
			name: 'article',
			display_name: 'Articles',
			fields: [{ name: 'title', field_type: 'text', required: false, unique: false, indexed: false }],
		},
		item: { id: 'e1', created_at: '2026-09-19T10:00:00Z', updated_at: '2026-09-19T10:00:00Z', data: { title: 'One' } },
		relationItems: {},
		revisions: [],
		localization: null,
		review: null,
		...overrides,
	} as unknown as PageData;
}

const localization = {
	locales: { default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: [] },
	translations: [{ locale: 'fr', title: 'Un', body: { title: 'Un' }, translation_status: 'outdated' }],
	unavailable: false,
};

describe('content entry editor, translations', () => {
	it('shows no Translations panel when the load carried none', () => {
		render(EntryPage, { props: { data: data(), form: null } });
		expect(screen.queryByTestId('translations-panel')).toBeNull();
	});

	it('renders the panel, with its beta badge, when the plugin is entitled', () => {
		render(EntryPage, { props: { data: data({ localization }), form: null } });
		expect(screen.getByTestId('translations-panel')).toBeTruthy();
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'fr, outdated' })).toBeTruthy();
	});

	it('shows a translation refusal in the panel and not on the entry form', () => {
		render(EntryPage, {
			props: {
				data: data({ localization }),
				form: { error: 'Failed to save the translation.', translationLocale: 'fr' } as never,
			},
		});
		const panel = screen.getByTestId('translations-panel');
		expect(panel.textContent).toContain('Failed to save the translation.');
		expect(screen.getAllByText('Failed to save the translation.')).toHaveLength(1);
	});
});

const review = {
	assignment: {
		id: 'a1',
		entry_id: 'e1',
		definition_id: 'd1',
		current_stage_id: 's1',
		assignee_id: 'u1',
		assigned_by: 'u2',
		assigned_at: '2026-09-19T10:00:00Z',
		status: 'pending_review',
		due_at: '2099-01-01T00:00:00Z',
		overdue_at: null,
		overdue: false,
		created_at: '',
		updated_at: '',
	},
	stages: [{ stage_id: 's1', stage_name: 'Copy edit', sla_duration_seconds: 3600, entry_time: '', exit_time: null, exceeded: false, over_seconds: 0 }],
	definitions: [],
	userId: 'u1',
	unavailable: false,
	forbidden: false,
};

describe('content entry editor, review bar', () => {
	it('shows no review bar when the plugin is not in the build', () => {
		render(EntryPage, { props: { data: data(), form: null } });
		expect(screen.queryByTestId('review-bar')).toBeNull();
	});

	it('renders the bar with the stage and the actions when the plugin is present', () => {
		render(EntryPage, { props: { data: data({ review }), form: null } });
		expect(screen.getByTestId('review-bar')).toBeTruthy();
		expect(screen.getByTestId('review-stage').textContent).toContain('Copy edit');
		expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
	});

	it('keeps a review refusal in the bar and off the entry form', () => {
		render(EntryPage, {
			props: {
				data: data({ review }),
				form: { error: 'permission denied: activate on review:editorial', review: true, reviewStatus: 403 } as never,
			},
		});
		expect(screen.getByTestId('review-bar').textContent).toContain('permission denied: activate on review:editorial');
		expect(screen.getAllByText('permission denied: activate on review:editorial')).toHaveLength(1);
		expect(screen.getByText('Not allowed')).toBeTruthy();
	});
});

const revision = (num: number) => ({
	id: `r${num}`,
	revision_num: num,
	created_at: '2026-10-01T10:00:00Z',
	created_by: 'u1',
	data: { title: 'One' },
});

describe('content entry editor, revision history', () => {
	it('ends the history with the older revisions the plugin left out, and offers the next one', async () => {
		render(EntryPage, {
			props: {
				data: data({ revisions: [revision(9), revision(8)], revisionWindow: { hiddenOlder: 7, windowDays: 30 } }),
				form: null,
			},
		});
		await fireEvent.click(screen.getByRole('button', { name: /history/i }));
		const older = screen.getByTestId('older-hidden');
		expect(older.textContent).toContain('7 older revisions');
		expect(older.textContent).toContain('the last 30 days');
		const open = older.querySelector('input[name="rev_num"]') as HTMLInputElement;
		expect(open.value).toBe('7');
		expect(screen.getByRole('button', { name: 'Open revision 7' })).toBeTruthy();
	});

	it('shows no such row when the install reads every revision', async () => {
		render(EntryPage, {
			props: { data: data({ revisions: [revision(2)], revisionWindow: { hiddenOlder: 0, windowDays: null } }), form: null },
		});
		await fireEvent.click(screen.getByRole('button', { name: /history/i }));
		expect(screen.queryByTestId('older-hidden')).toBeNull();
	});

	it('renders a refused open in the history panel with the license notice, and not on the entry form', () => {
		render(EntryPage, {
			props: {
				data: data({ revisions: [revision(9)], revisionWindow: { hiddenOlder: 3, windowDays: 30 } }),
				form: {
					error: 'refused',
					revision: true,
					refused: { kind: 'feature', feature: 'example-feature', plugin: 'content', upgradeUrl: '' },
				} as never,
			},
		});
		const panel = screen.getByTestId('revision-history');
		expect(panel.querySelector('[data-testid="refusal-notice"]')).not.toBeNull();
		expect(screen.getAllByTestId('refusal-notice')).toHaveLength(1);
	});

	it('shows a revision the plugin opened, with a way to restore it', () => {
		render(EntryPage, {
			props: {
				data: data({ revisions: [revision(9)], revisionWindow: { hiddenOlder: 0, windowDays: null } }),
				form: { openedRevision: revision(4) } as never,
			},
		});
		const opened = screen.getByTestId('opened-revision');
		expect(opened.textContent).toContain('Revision 4');
		expect((opened.querySelector('input[name="rev_num"]') as HTMLInputElement).value).toBe('4');
	});
});
