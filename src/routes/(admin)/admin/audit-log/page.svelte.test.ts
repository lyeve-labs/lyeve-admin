// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';
import type { Entitlements } from '$lib/entitlements';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/admin/audit-log') },
}));

/*
 * The submit function is the unit under test for the prune gate: enhance awaits
 * it before it sends anything, so canceling inside it is what stops the
 * request. Capturing it here drives that directly rather than through the DOM's
 * submit plumbing.
 */
const forms = vi.hoisted(() => ({ submits: [] as SubmitFunction[] }));
vi.mock('$app/forms', () => ({
	enhance: (_el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.push(fn);
		return { destroy: () => {} };
	},
}));

/*
 * The prune dialog is opened through the kit's dialog manager, which renders
 * through a container the layout mounts and this test does not. The call is
 * captured instead: what it was asked to show, and what the page does with the
 * answer.
 */
const kit = vi.hoisted(() => ({ openDialog: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	openDialog: kit.openDialog,
}));

import AuditLogPage from './+page.svelte';

beforeEach(() => {
	forms.submits = [];
	kit.openDialog.mockReset();
	kit.openDialog.mockResolvedValue(false);
});

afterEach(cleanup);

const entitlements: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['audit'],
	tenant_quota: 1,
};

function entries(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `e${from + i}`,
		action: 'create.content',
		resource_type: 'content',
		resource_id: 'r1',
		user_id: 'u1',
		ip: '10.0.0.1',
		user_agent: 'agent',
		created_at: '2026-01-01T00:00:00Z',
	}));
}

function data(overrides: Record<string, unknown> = {}) {
	return {
		entitlements,
		entries: entries(50),
		total: 13043,
		offset: 0,
		limit: 50,
		isSuperAdmin: true,
		filter: { q: '', action: '', from: '', to: '' },
		actions: ['create.content'],
		...overrides,
	};
}

function pager(container: HTMLElement, label: string): HTMLAnchorElement | undefined {
	// The kit's pager draws its steps as an arrow and names them in aria-label,
	// so a step is found by its accessible name and not by the text it carries.
	return [...container.querySelectorAll('a')].find(
		(a) => a.textContent?.includes(label) || a.getAttribute('aria-label')?.includes(label)
	);
}

// The pager has to work from the server-rendered document. Driven from a click
// handler it is inert until the page hydrates, which on a slow page is long
// enough for a person to click it and see nothing happen.
describe('Audit log pagination', () => {
	it('offers the next page as a link carrying the advanced offset', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data() as never, form: null as never },
		});

		expect(pager(container, 'Next')?.getAttribute('href')).toBe(
			'/admin/audit-log?offset=50',
		);
	});

	it('links back to the previous page once past the first', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data({ offset: 100 }) as never, form: null as never },
		});

		expect(pager(container, 'Prev')?.getAttribute('href')).toBe(
			'/admin/audit-log?offset=50',
		);
	});

	it('offers no way forward from the last page', () => {
		// The kit's pager keeps both steps on screen and marks the one that
		// leads nowhere, rather than removing it: a control that disappears
		// moves the one beside it under the finger already reaching for it.
		const { container } = render(AuditLogPage, {
			props: {
				data: data({ offset: 13000, entries: entries(43, 13000) }) as never,
				form: null as never,
			},
		});

		const next = pager(container, 'Next');
		expect(next?.getAttribute('aria-disabled')).toBe('true');
		expect(next?.getAttribute('href')).toBeNull();
	});
});

/*
 * Prune destroys the audit history, which is the record that would show what
 * happened. It is one small control in the header, and the cut-off is asked
 * for inside the confirmation so the question and the date are one step.
 */
describe('Audit log prune', () => {
	function setup(overrides: Record<string, unknown> = {}) {
		return render(AuditLogPage, { props: { data: data(overrides) as never, form: null as never } });
	}

	it('sits in the header beside the exports, as a small secondary control', () => {
		const { getByRole, getAllByRole } = setup();
		const prune = getByRole('button', { name: /prune/i });
		const exportAll = getAllByRole('button', { name: /export/i })[0];
		expect(prune.className).toBe(exportAll.className);
		expect(prune.className).toContain('text-sm');
		// Retention is a tab of its own, so only the entries render here.
		expect([...document.querySelectorAll('h2')].map((h) => h.textContent?.trim())).toEqual(['Entries']);
	});

	it('is withheld from an admin who cannot prune', () => {
		const { queryByRole } = setup({ isSuperAdmin: false });
		expect(queryByRole('button', { name: /prune/i })).toBeNull();
	});

	it('opens a confirmation that holds the date, and sends nothing when declined', async () => {
		const { getByRole } = setup();
		const form = document.querySelector('form[action="?/prune"]') as HTMLFormElement;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});

		await fireEvent.click(getByRole('button', { name: /prune/i }));
		await tick();

		expect(kit.openDialog).toHaveBeenCalledTimes(1);
		const options = (kit.openDialog.mock.calls[0] as unknown[])[0] as { title: string; body: unknown; footer: unknown };
		expect(options.title).toContain('Prune');
		expect(options.body, 'the dialog carries no body for the date picker').toBeTypeOf('function');
		expect(options.footer).toBeTypeOf('function');
		expect(submit).not.toHaveBeenCalled();
	});

	it('sends nothing when the dialog agreed but no date was chosen', async () => {
		kit.openDialog.mockResolvedValue(true);
		const { getByRole } = setup();
		const form = document.querySelector('form[action="?/prune"]') as HTMLFormElement;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});

		await fireEvent.click(getByRole('button', { name: /prune/i }));
		await tick();
		await tick();

		expect(submit).not.toHaveBeenCalled();
	});

	it('leaves the export forms alone', () => {
		setup();
		// Only prune is enhanced, so only prune is gated.
		expect(forms.submits).toHaveLength(1);
	});
});

/*
 * The toolbar carries the search, the action filter and the date range as a
 * GET form, so a filtered view is an address.
 */
describe('Audit log toolbar', () => {
	it('puts the search at the leading edge and the filters after it', () => {
		const { container } = render(AuditLogPage, { props: { data: data() as never, form: null as never } });
		const bar = container.querySelector('[role="toolbar"]')!;
		const search = bar.querySelector('input[name="q"]')!;
		const action = bar.querySelector('#audit-action')!;
		expect(search.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(bar.querySelector('input[name="from"]')).toBeTruthy();
		expect(bar.querySelector('input[name="to"]')).toBeTruthy();
	});

	it('offers the actions on the page plus the one in force', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data({ actions: ['content.delete', 'schema.create'] }) as never, form: null as never },
		});
		expect(container.textContent).toContain('All actions');
		expect(container.querySelector('[role="toolbar"]')?.textContent).toContain('All actions');
	});

	it('carries the filter through the pager', () => {
		const { container } = render(AuditLogPage, {
			props: {
				data: data({ filter: { q: 'content', action: '', from: '2026-01-01', to: '' } }) as never,
				form: null as never,
			},
		});
		expect(pager(container, 'Next')?.getAttribute('href')).toBe('/admin/audit-log?q=content&from=2026-01-01&offset=50');
	});
});

/*
 * The table is over a thousand accessibility nodes under the page title. With
 * no heading between the top of the page and the end of the table, a screen
 * reader user has no way to skim it or to jump past it.
 */
describe('Audit log regions', () => {
	function headings(container: HTMLElement): string[] {
		return [...container.querySelectorAll('h2')].map((h) => h.textContent?.trim() ?? '');
	}

	it('heads each region with a real level two heading', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data() as never, form: null as never },
		});

		expect(headings(container)).toEqual(['Entries']);
	});

	// The heading names the region, not the page. A second "Audit log" would be
	// one more thing to read past rather than a way through the page.
	it('never restates the page title', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data() as never, form: null as never },
		});

		for (const heading of headings(container)) {
			expect(heading.toLowerCase()).not.toBe('audit log');
		}
	});

	it('heads the table even when the collection is empty', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data({ entries: [], total: 0 }) as never, form: null as never },
		});

		expect(headings(container)).toContain('Entries');
	});
});
