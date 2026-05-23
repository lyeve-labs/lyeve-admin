// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getThemePreference, resolveTheme, type ThemePreference } from '@lyeve-labs/ui-kit';

/**
 * The palette on the first paint.
 *
 * app.html resolves the palette in an inline script before anything renders,
 * so the dark default never flashes past a reader who chose light. That script
 * cannot import, so it restates the storage key and the resolution rule that
 * the kit's theme utilities apply at runtime. Restating them is what lets the
 * two drift, and drift here is the flash the script exists to prevent, so the
 * cases below run the shipped script and compare what it paints against what
 * the kit reads back from the same storage.
 *
 * The script is executed rather than pattern-matched. A test asserting that a
 * key appears in the file passes on a script that reads the key and then throws
 * it away.
 */
// Off the project root rather than off import.meta.url: these cases need a DOM
// to paint into, and under jsdom import.meta.url is an http URL that
// fileURLToPath refuses.
const appHtml = readFileSync(resolve(process.cwd(), 'src/app.html'), 'utf8');

const CURRENT_KEY = 'lyeve-theme';

function bootScript(): string {
	const found = appHtml.match(/<script nonce="%sveltekit\.nonce%">([\s\S]*?)<\/script>/);
	if (!found) throw new Error('app.html ships no nonced pre-paint script');
	return found[1];
}

function paint(): void {
	new Function(bootScript())();
}

function painted(): string | null {
	return document.documentElement.getAttribute('data-theme');
}

/** Answers both spellings of the query, so either direction reads the desktop. */
function desktopPrefers(theme: 'light' | 'dark'): void {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: query.includes(theme),
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
}

beforeEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-theme');
	desktopPrefers('dark');
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('pre-paint palette', () => {
	it('paints a stored choice', () => {
		localStorage.setItem(CURRENT_KEY, 'light');
		paint();
		expect(painted()).toBe('light');
	});

	it('follows the desktop when the reader has chosen nothing', () => {
		desktopPrefers('light');
		paint();
		expect(painted()).toBe('light');
	});

	it('follows the desktop for a reader who asked to follow it', () => {
		localStorage.setItem(CURRENT_KEY, 'system');
		desktopPrefers('light');
		paint();
		expect(painted()).toBe('light');
	});

	// Dark is the brand palette, the markup default and the theme-color meta.
	it('paints dark where the desktop states no preference', () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
		paint();
		expect(painted()).toBe('dark');
	});

	it('leaves the dark markup default alone where there is no matchMedia', () => {
		vi.stubGlobal('matchMedia', undefined);
		expect(() => paint()).not.toThrow();
		expect(painted()).toBeNull();
	});

	// Private mode throws on read. The desktop is still readable, so the reader
	// gets the palette their machine asks for rather than the default.
	it('follows the desktop when storage refuses to be read', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError');
		});
		desktopPrefers('light');
		expect(() => paint()).not.toThrow();
		expect(painted()).toBe('light');
	});

	/**
	 * The property that matters: whatever the script paints is what the kit
	 * resolves a moment later from the same storage. A disagreement in any of
	 * these cells is a repaint the reader sees.
	 */
	it.each([
		[null, 'light'],
		[null, 'dark'],
		['light', 'dark'],
		['dark', 'light'],
		['system', 'light'],
		['system', 'dark'],
		['chartreuse', 'light'],
		['chartreuse', 'dark'],
	] as const)('agrees with the kit for stored %s on a %s desktop', (stored, desktop) => {
		if (stored !== null) localStorage.setItem(CURRENT_KEY, stored);
		desktopPrefers(desktop);
		paint();

		expect(painted()).toBe(resolveTheme(getThemePreference()));
	});
});

describe('the script itself', () => {
	// script-src is locked to 'self', and an inline script without the nonce is
	// refused: the page then paints dark and repaints on hydration.
	it('carries the nonce the policy requires', () => {
		expect(appHtml).toMatch(/<script nonce="%sveltekit\.nonce%">/);
	});

	// The markup default is what a reader with no JavaScript is served, and the
	// theme-color meta has to name the same palette.
	it('defaults the document to dark before any of it runs', () => {
		expect(appHtml).toMatch(/<html lang="en" data-theme="dark">/);
	});
});
