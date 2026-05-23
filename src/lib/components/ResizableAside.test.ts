// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import ResizableAside from './ResizableAside.svelte';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const body = createRawSnippet(() => ({ render: () => '<p>body</p>' }));
const count = createRawSnippet(() => ({ render: () => '<span>12</span>' }));

const KEY = 'lyeve-test-aside';
const BOUNDS = { width: 260, min: 200, max: 500 };

type Props = Partial<{
	side: 'start' | 'end';
	breakpoint: 'md' | 'lg' | 'xl';
	below: 'stack' | 'overlay' | 'hidden';
	overlay: boolean;
	collapsible: boolean;
	open: boolean;
	class: string;
	meta: typeof count;
}>;

function setup(props: Props = {}) {
	const result = render(ResizableAside, {
		props: { storageKey: KEY, label: 'Things', side: props.side ?? 'start', ...BOUNDS, ...props, children: body },
	});
	const aside = result.getByTestId(`aside-${KEY}`);
	return {
		...result,
		aside,
		widthOf: () => aside.style.getPropertyValue('--panel-w'),
		handle: () => result.queryByTestId(`aside-${KEY}-handle`),
		stored: () => JSON.parse(localStorage.getItem(KEY) ?? 'null'),
	};
}

describe('ResizableAside', () => {
	it('opens at its default width, or at the remembered width and lock', () => {
		expect(setup().widthOf()).toBe('260px');
		cleanup();
		localStorage.setItem(KEY, JSON.stringify({ width: 400, locked: true }));
		const { widthOf, handle, getByRole } = setup();
		expect(widthOf()).toBe('400px');
		expect(handle()).toBeNull();
		expect(getByRole('button', { name: 'Unlock Things width' }).getAttribute('aria-pressed')).toBe('true');
	});

	it('survives storage that throws', () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('refused');
		});
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('refused');
		});
		const { widthOf, handle } = setup();
		expect(widthOf()).toBe('260px');
		expect(() => fireEvent.keyDown(handle() as HTMLElement, { key: 'ArrowRight' })).not.toThrow();
		getItem.mockRestore();
		setItem.mockRestore();
	});

	it('drags the inner edge in the direction that grows it and remembers the width on release', async () => {
		const start = setup({ side: 'start' });
		const h = start.handle() as HTMLElement;
		await fireEvent.pointerDown(h, { button: 0, clientX: 260, pointerId: 1 });
		await fireEvent.pointerMove(h, { clientX: 320, pointerId: 1 });
		expect(start.widthOf()).toBe('320px');
		expect(start.stored()).toBeNull();
		await fireEvent.pointerUp(h, { clientX: 320, pointerId: 1 });
		expect(start.stored()).toEqual({ width: 320, locked: false });
		cleanup();
		localStorage.clear();

		// An end aside grows leftwards: a pointer moving left makes it wider.
		const end = setup({ side: 'end' });
		const e = end.handle() as HTMLElement;
		await fireEvent.pointerDown(e, { button: 0, clientX: 900, pointerId: 1 });
		await fireEvent.pointerMove(e, { clientX: 840, pointerId: 1 });
		expect(end.widthOf()).toBe('320px');
		expect(e.className).toContain('-left-1');
	});

	it('ignores a press that is not the primary button', async () => {
		const { handle, widthOf } = setup();
		const h = handle() as HTMLElement;
		await fireEvent.pointerDown(h, { button: 2, clientX: 260, pointerId: 1 });
		await fireEvent.pointerMove(h, { clientX: 400, pointerId: 1 });
		expect(widthOf()).toBe('260px');
	});

	it('clamps to the bounds and announces them', async () => {
		const { handle, widthOf } = setup();
		const h = handle() as HTMLElement;
		await fireEvent.pointerDown(h, { button: 0, clientX: 260, pointerId: 1 });
		await fireEvent.pointerMove(h, { clientX: -500, pointerId: 1 });
		expect(widthOf()).toBe('200px');
		await fireEvent.pointerMove(h, { clientX: 5000, pointerId: 1 });
		expect(widthOf()).toBe('500px');
		expect(h.getAttribute('aria-valuemin')).toBe('200');
		expect(h.getAttribute('aria-valuemax')).toBe('500');
		expect(h.getAttribute('role')).toBe('separator');
	});

	it('nudges by a step from the keyboard, more with Shift, and writes each step', async () => {
		const { handle, widthOf, stored } = setup();
		const h = handle() as HTMLElement;
		await fireEvent.keyDown(h, { key: 'ArrowRight' });
		expect(widthOf()).toBe('284px');
		await fireEvent.keyDown(h, { key: 'ArrowLeft', shiftKey: true });
		expect(widthOf()).toBe('204px');
		expect(stored().width).toBe(204);
		expect(h.getAttribute('aria-valuenow')).toBe('204');
		await fireEvent.keyDown(h, { key: 'ArrowUp' });
		expect(widthOf()).toBe('204px');
	});

	it('locks the width: the handle goes and the lock is remembered', async () => {
		const { getByRole, handle, stored, aside } = setup();
		await fireEvent.click(getByRole('button', { name: 'Lock Things width' }));
		expect(handle()).toBeNull();
		expect(aside.getAttribute('data-locked')).toBe('true');
		expect(stored()).toEqual({ width: 260, locked: true });
		await fireEvent.click(getByRole('button', { name: 'Unlock Things width' }));
		expect(handle()).not.toBeNull();
		expect(stored().locked).toBe(false);
	});

	it('offers no collapse unless asked, and folds to a strip that expands again when it is', async () => {
		const plain = setup();
		expect(plain.queryByRole('button', { name: 'Collapse Things' })).toBeNull();
		expect(plain.queryByTestId(`aside-${KEY}-strip`)).toBeNull();
		cleanup();

		const { getByRole, getByTestId, aside, getByText } = setup({ collapsible: true });
		await fireEvent.click(getByRole('button', { name: 'Collapse Things' }));
		expect(aside.getAttribute('data-open')).toBe('false');
		expect(aside.className).toContain('xl:w-8');
		const strip = getByTestId(`aside-${KEY}-strip`);
		expect(strip.textContent).toContain('Things');
		expect(strip.className).toContain('xl:flex');
		await fireEvent.click(getByRole('button', { name: 'Expand Things' }));
		expect(aside.getAttribute('data-open')).toBe('true');
		expect(aside.className).not.toContain('xl:w-8');
		expect(getByText('body')).toBeTruthy();
	});

	it('stacks in the page flow under the breakpoint and docks at its width above it', () => {
		const { aside, handle } = setup({ breakpoint: 'md', class: 'max-h-2/5' });
		expect(aside.className).toMatch(/(^|\s)flex(\s|$)/);
		expect(aside.className).toContain('border-b');
		expect(aside.className).toContain('md:border-b-0');
		expect(aside.className).toContain('md:w-(--panel-w)');
		expect(aside.className).toContain('md:border-r');
		expect(aside.className).toContain('max-h-2/5');
		expect(aside.className).not.toContain('absolute');
		// No drag below the breakpoint: the handle is hidden until md.
		expect((handle() as HTMLElement).className).toContain('md:block');
	});

	it('hides under the breakpoint when asked to', () => {
		const { aside } = setup({ breakpoint: 'lg', below: 'hidden', side: 'end' });
		expect(aside.className).toMatch(/(^|\s)hidden(\s|$)/);
		expect(aside.className).toContain('lg:flex');
		expect(aside.className).toContain('lg:border-l');
	});

	it('floats as an overlay under the breakpoint, hidden until asked for', () => {
		expect(setup({ below: 'overlay' }).aside.className).toMatch(/(^|\s)hidden(\s|$)/);
		cleanup();
		const { aside } = setup({ below: 'overlay', overlay: true });
		expect(aside.className).toContain('absolute');
		expect(aside.className).not.toMatch(/(^|\s)hidden(\s|$)/);
		expect(aside.className).toContain('xl:static');
	});

	it('keeps the caller-supplied meta beside the label', () => {
		const { getByRole, getByText } = setup({ meta: count });
		const heading = getByRole('heading', { level: 2 });
		expect(heading.textContent).toContain('Things');
		expect(heading.parentElement?.contains(getByText('12'))).toBe(true);
	});
});
