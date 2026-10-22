// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/settings/content-history') } }));

import Page from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

type Settings = {
	history_mode: 'off' | 'all' | 'selected';
	schemas: string[];
	keep_days: number;
	keep_versions: number;
	activity_enabled: boolean;
	activity_keep_days: number;
};

const SETTINGS: Settings = {
	history_mode: 'selected',
	schemas: ['article'],
	keep_days: 0,
	keep_versions: 20,
	activity_enabled: true,
	activity_keep_days: 0,
};

function props({
	settings = SETTINGS,
	locked = [] as string[],
	env = { history: 'console', activity: 'console' },
	readsOlder = false,
	gate = null as unknown,
	form = null as unknown,
} = {}) {
	return {
		data: {
			settings: gate
				? { ok: false, gate }
				: { ok: true, value: { settings, locked, env, defaults: { keep_days: 0, keep_versions: 0, activity_keep_days: 0 } } },
			usage: {
				ok: true,
				value: {
					commits: 120,
					objects: 300,
					stored_bytes: 16384,
					logical_bytes: 65536,
					legacy_rows: 40,
					legacy_bytes: 2048,
					oldest_at: '2026-01-02T00:00:00Z',
				},
			},
			schemas: {
				ok: true,
				value: [
					{ name: 'article', label: 'Articles' },
					{ name: 'page', label: 'Pages' },
				],
			},
			readsOlder,
		} as never,
		form: form as never,
	};
}

const FIELDS = ['history_mode', 'schemas_sent', 'schemas', 'keep_days', 'keep_versions', 'activity', 'activity_keep_days'];
const segment = (c: HTMLElement, id: string) => c.querySelector(`#${id}`) as HTMLElement;

const hidden = (c: HTMLElement, name: string) =>
	[...c.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map((i) => i.value);

describe('content history settings', () => {
	it('offers the types to choose in Selected types, checked as stored', () => {
		render(Page, { props: props() });
		expect((screen.getByLabelText('Articles') as HTMLInputElement).checked).toBe(true);
		expect((screen.getByLabelText('Pages') as HTMLInputElement).checked).toBe(false);
	});

	it('posts no field the reader has not changed', () => {
		const { container } = render(Page, { props: props() });
		for (const name of FIELDS) expect(hidden(container, name), name).toEqual([]);
	});

	it('posts only the activity switch when that is all the reader changed', async () => {
		const { container } = render(Page, { props: props() });
		await fireEvent.click(within(segment(container, 'activity-enabled')).getByRole('radio', { name: 'Off' }));
		expect(hidden(container, 'activity')).toEqual(['off']);
		for (const name of FIELDS.filter((n) => n !== 'activity')) expect(hidden(container, name), name).toEqual([]);
	});

	it('posts a retention limit the reader set, and 0 when they lift one', async () => {
		const { container } = render(Page, { props: props() });
		await fireEvent.click(within(segment(container, 'keep-days-limit')).getByRole('radio', { name: 'A number of days' }));
		expect(hidden(container, 'keep_days')).toEqual(['30']);
		await fireEvent.click(within(segment(container, 'keep-versions-limit')).getByRole('radio', { name: 'Unlimited' }));
		expect(hidden(container, 'keep_versions')).toEqual(['0']);
		expect(hidden(container, 'activity_keep_days')).toEqual([]);
	});

	it('sends the stored types along when the reader switches to Selected types', async () => {
		const { container } = render(Page, { props: props({ settings: { ...SETTINGS, history_mode: 'all' } }) });
		expect(screen.queryByLabelText('Articles')).toBeNull();
		await fireEvent.click(within(segment(container, 'history-mode')).getByRole('radio', { name: 'Selected types' }));
		expect(hidden(container, 'history_mode')).toEqual(['selected']);
		expect(hidden(container, 'schemas_sent')).toEqual(['1']);
		expect(hidden(container, 'schemas')).toEqual(['article']);
	});

	it('posts the types when the reader changes the choice', async () => {
		const { container } = render(Page, { props: props() });
		await fireEvent.click(screen.getByLabelText('Pages'));
		expect(hidden(container, 'history_mode')).toEqual([]);
		expect(hidden(container, 'schemas').sort()).toEqual(['article', 'page']);
	});

	it('names what the environment fixes and posts none of the locked fields', () => {
		const { container } = render(Page, {
			props: props({ locked: ['history_mode', 'schemas'], env: { history: 'off', activity: 'console' } }),
		});
		expect(said(container)).toContain('Content history is off for every tenant (CONTENT_HISTORY=off).');
		expect(hidden(container, 'history_mode')).toEqual([]);
		expect(hidden(container, 'schemas_sent')).toEqual([]);
		expect(hidden(container, 'schemas')).toEqual([]);
	});

	it('draws a locked field from the value in effect, with no case of its own', () => {
		const { container } = render(Page, {
			props: props({
				settings: { ...SETTINGS, history_mode: 'all', keep_days: 14 },
				locked: ['history_mode', 'schemas', 'keep_days'],
				env: { history: 'on', activity: 'console' },
			}),
		});
		const mode = container.querySelector('#history-mode') as HTMLElement;
		const pressed = mode.querySelectorAll('[aria-checked="true"]');
		expect(pressed).toHaveLength(1);
		expect(pressed[0].textContent).toContain('All types');
		expect((screen.getByLabelText('Days') as HTMLInputElement).value).toBe('14');
		expect((screen.getByLabelText('Days') as HTMLInputElement).disabled).toBe(true);
		for (const name of FIELDS) expect(hidden(container, name), name).toEqual([]);
	});

	it('shows no lock banner when the tenant decides everything', () => {
		const { container } = render(Page, { props: props() });
		expect(said(container)).not.toContain("The server's environment sets these");
	});

	it('says older versions need the capability to read, only when the license lacks it', () => {
		const lacking = render(Page, { props: props() });
		expect(said(lacking.container)).toContain('reading them needs a license with the content-pro feature');
		cleanup();
		const licensed = render(Page, { props: props({ readsOlder: true }) });
		expect(said(licensed.container)).not.toContain('content-pro');
	});

	it('shows stored bytes against full copies', () => {
		const { container } = render(Page, { props: props() });
		const usage = container.querySelector('[data-testid="history-usage"]') as HTMLElement;
		expect(said(usage)).toContain('16.0 KB');
		expect(said(usage)).toContain('64.0 KB');
		expect(said(usage)).toContain('75.0% less than full copies');
		expect(said(usage)).toContain('120');
	});

	it('says an older engine does not keep the settings, instead of failing', () => {
		const { container } = render(Page, { props: props({ gate: { state: 'absent' } }) });
		expect(said(container)).toContain('This engine does not keep content history settings.');
		expect(container.querySelector('form[action="?/save"]')).toBeNull();
	});

	it('draws a failed read as a failure with a way to try again', () => {
		render(Page, { props: props({ gate: { state: 'unavailable' } }) });
		expect(screen.getByText(/did not answer/)).toBeTruthy();
		expect(screen.getByRole('link', { name: /Try again/ }).getAttribute('href')).toBe('/admin/settings/content-history');
	});

	it("renders a save's refusal", () => {
		const { container } = render(Page, {
			props: props({ form: { action: 'save', error: "The server's environment now fixes a setting this form changed." } }),
		});
		expect(said(container)).toContain('now fixes a setting');
	});

	it('reports what a prune removed', () => {
		const { container } = render(Page, {
			props: props({ form: { action: 'prune', pruned: { commits: 12, legacy_rows: 3, activity_rows: 40, done: true } } }),
		});
		expect(said(container)).toContain('Removed 12 versions, 3 earlier revisions and 40 activity rows.');
		expect(said(container)).not.toContain('background');
	});

	it('says pruning continues in the background when the run did not finish', () => {
		const { container } = render(Page, {
			props: props({ form: { action: 'prune', pruned: { commits: 500, legacy_rows: 0, activity_rows: 0, done: false } } }),
		});
		expect(said(container)).toContain('Removed 500 versions, 0 earlier revisions and 0 activity rows so far.');
		expect(said(container)).toContain('Pruning continues in the background.');
	});

	it('says how many versions a legal hold kept from a delete', () => {
		const { container } = render(Page, {
			props: props({ form: { action: 'deleteType', deleted: 'article', commits: 10, held: 3 } }),
		});
		expect(said(container)).toContain('A legal hold kept 3 versions of Articles.');
	});

	it('says nothing of a hold when none kept a version', () => {
		const { container } = render(Page, {
			props: props({ form: { action: 'deleteType', deleted: 'article', commits: 10, held: 0 } }),
		});
		expect(said(container)).not.toContain('A legal hold kept');
	});
});
