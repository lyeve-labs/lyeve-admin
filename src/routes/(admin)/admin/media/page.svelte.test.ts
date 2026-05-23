// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

vi.mock('$app/environment', () => ({ browser: true }));

/*
 * The submit function is what the delete goes through. enhance awaits it
 * before it sends anything, so capturing it here drives the round trip
 * without the DOM's submit plumbing.
 */
const forms = vi.hoisted(() => ({ submits: [] as SubmitFunction[] }));
vi.mock('$app/forms', () => ({
	enhance: (_el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.push(fn);
		return { destroy() {} };
	},
}));
const nav = vi.hoisted(() => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false), success: vi.fn() }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		confirm: kit.confirm,
		toast: { ...(actual.toast as object), success: kit.success },
	};
});

import MediaPage from './+page.svelte';
import type { PageData } from './$types';
import type { MediaItem } from '$lib/api/media';
import { MEDIA_VIEW_KEY } from '$lib/components/media/view-preference';
import { IMAGE, ONE_OF_EACH, PDF } from '$lib/components/media/fixtures';

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	forms.submits = [];
	kit.confirm.mockResolvedValue(false);
	localStorage.clear();
});

function setup(items: MediaItem[] = ONE_OF_EACH, extra: Partial<PageData> = {}) {
	return render(MediaPage, {
		props: {
			data: {
				items,
				limit: 60,
				offset: 0,
				total: items.length,
				hasMore: false,
				q: '',
				...extra,
			} as unknown as PageData,
			form: null,
		},
	});
}

const viewSwitch = () => screen.getByRole('radiogroup', { name: 'View' });
const segment = (name: string) => screen.getByRole('radio', { name });

describe('media library views', () => {
	it('opens on the grid when the viewer has chosen nothing', () => {
		setup();
		expect(screen.getByTestId('media-grid')).toBeTruthy();
		expect(screen.queryByTestId('media-list')).toBeNull();
		expect(segment('Grid').getAttribute('aria-checked')).toBe('true');
	});

	it('switches to the list and remembers it for this viewer', async () => {
		setup();
		await fireEvent.click(segment('List'));
		expect(screen.getByTestId('media-list')).toBeTruthy();
		expect(screen.queryByTestId('media-grid')).toBeNull();
		expect(localStorage.getItem(MEDIA_VIEW_KEY)).toBe('list');
	});

	it('opens on the view the viewer chose last time', async () => {
		localStorage.setItem(MEDIA_VIEW_KEY, 'list');
		setup();
		await waitFor(() => expect(screen.getByTestId('media-list')).toBeTruthy());
		expect(segment('List').getAttribute('aria-checked')).toBe('true');
	});

	it('puts the search at the start of the toolbar and the view switch at its end', () => {
		setup();
		const toolbar = screen.getByRole('toolbar', { name: 'Filter media' });
		const search = screen.getByLabelText('Search files');
		expect(toolbar.contains(search)).toBe(true);
		expect(toolbar.contains(viewSwitch())).toBe(true);
		expect(search.compareDocumentPosition(viewSwitch()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect((search.closest('form') as HTMLFormElement).getAttribute('method')).toBe('GET');
		expect(search.getAttribute('name')).toBe('q');
	});

	it('offers to clear an active search, and says when nothing matched', () => {
		setup([], { q: 'nothing' });
		expect(screen.getByRole('link', { name: 'Clear' }).getAttribute('href')).toBe('/admin/media');
		expect(screen.getByText('No files match')).toBeTruthy();
	});
});

describe('media library preview', () => {
	it('opens the drawer for the tile that was pressed', async () => {
		setup();
		expect(screen.queryByRole('dialog')).toBeNull();
		const tile = screen
			.getAllByRole('button')
			.find((el) => (el.textContent ?? '').includes('invoice.pdf')) as HTMLElement;
		await fireEvent.click(tile);
		const dialog = screen.getByRole('dialog');
		expect(dialog.textContent).toContain('invoice.pdf');
		expect(dialog.querySelector('[data-testid="media-preview"]')?.getAttribute('data-kind')).toBe('pdf');
	});

	it('opens the drawer from a list row too', async () => {
		localStorage.setItem(MEDIA_VIEW_KEY, 'list');
		setup();
		await waitFor(() => expect(screen.getByTestId('media-list')).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'photo.png' }));
		expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe(
			'/api/admin/media/m-image/download'
		);
	});

	it('deletes through the form action once confirmed, then shuts the drawer', async () => {
		kit.confirm.mockResolvedValue(true);
		const { container, rerender } = setup();
		const tile = screen
			.getAllByRole('button')
			.find((el) => (el.textContent ?? '').includes('clip.webm')) as HTMLElement;
		await fireEvent.click(tile);

		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		const submitted = vi.fn();
		form.requestSubmit = submitted;

		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(submitted).toHaveBeenCalled());
		expect((form.querySelector('[name="id"]') as HTMLInputElement).value).toBe('m-video');

		// The round trip: the action answers, the page reloads without the row.
		const submit = forms.submits[0] as SubmitFunction;
		const after = await submit({ formData: new FormData() } as never);
		const update = vi.fn(async () => {});
		await (after as (a: unknown) => Promise<void>)({ result: { type: 'success' }, update });
		expect(update).toHaveBeenCalled();
		expect(kit.success).toHaveBeenCalledWith('Deleted clip.webm');

		await rerender({
			data: { items: [IMAGE, PDF], limit: 60, offset: 0, total: 2, hasMore: false, q: '' } as unknown as PageData,
			form: null,
		});
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('leaves the file alone when the operator cancels', async () => {
		const { container } = setup();
		const tile = screen
			.getAllByRole('button')
			.find((el) => (el.textContent ?? '').includes('clip.webm')) as HTMLElement;
		await fireEvent.click(tile);
		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		const submitted = vi.fn();
		form.requestSubmit = submitted;

		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(kit.confirm).toHaveBeenCalled());
		expect(submitted).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog')).toBeTruthy();
	});
});

describe('media library upload', () => {
	it('posts each file to the media endpoint and goes to the first page', async () => {
		const fetch = vi.fn(async () => new Response('{}', { status: 201 }));
		vi.stubGlobal('fetch', fetch);
		setup();

		const picker = screen.getByLabelText('Choose files to upload') as HTMLInputElement;
		const file = new File(['x'], 'new.png', { type: 'image/png' });
		Object.defineProperty(picker, 'files', { value: [file], configurable: true });
		await fireEvent.change(picker);

		await waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/admin/media', { invalidateAll: true }));
		expect(fetch).toHaveBeenCalledTimes(1);
		expect((fetch.mock.calls[0] as unknown[])[0]).toBe('/api/admin/media');
		expect(kit.success).toHaveBeenCalledWith('Uploaded 1 file');
		vi.unstubAllGlobals();
	});
});

describe('media library controls carry a name', () => {
	it('names the file picker the upload button opens', () => {
		// sr-only hides the picker from the eye and not from a screen reader, so
		// without a label it is reached as a file field with no name at all.
		setup();

		const picker = screen.getByLabelText('Choose files to upload') as HTMLInputElement;
		expect(picker.type).toBe('file');
	});

	it('names the picker on an empty library too', () => {
		setup([]);

		expect(screen.getByLabelText('Choose files to upload')).toBeTruthy();
	});

	it('leaves no control on the page without a name', () => {
		const { container } = setup();

		const unnamed = [...container.querySelectorAll('button, input, a[href]')].filter((el) => {
			// A hidden input is a value, not a control anyone reaches.
			if (el.getAttribute('type') === 'hidden') return false;
			if (el.getAttribute('aria-label') || el.getAttribute('title')) return false;
			if (el.getAttribute('aria-hidden') === 'true') return false;
			const labeled = el.id && container.querySelector(`label[for="${el.id}"]`);
			return !labeled && (el.textContent ?? '').trim() === '';
		});

		expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
	});
});
