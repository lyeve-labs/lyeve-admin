import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * Contrast floor for the admin palette.
 *
 * The token values are read out of the stylesheets rather than restated here,
 * so lowering a value in app.css (or picking up a kit release that lowers one)
 * fails this suite instead of shipping.
 *
 * Bars follow WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for graphical objects
 * such as status dots and icon chips. Nothing in the admin renders a token at
 * large-text size, so no pair claims the 3:1 large-text allowance.
 */

const require = createRequire(import.meta.url);
const APP_CSS = fileURLToPath(new URL('./app.css', import.meta.url));
const KIT_CSS = require.resolve('@lyeve-labs/ui-kit/styles.css');

// CSS token extraction

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Bodies of every block opened by `header`, in source order. */
function blocks(css: string, header: string): string[] {
	const out: string[] = [];
	let from = 0;
	for (;;) {
		const at = css.indexOf(header, from);
		if (at === -1) return out;
		const open = css.indexOf('{', at);
		let depth = 0;
		let i = open;
		for (; i < css.length; i++) {
			if (css[i] === '{') depth++;
			else if (css[i] === '}' && --depth === 0) break;
		}
		out.push(css.slice(open + 1, i));
		from = i;
	}
}

function colorTokens(body: string): Record<string, string> {
	const out: Record<string, string> = {};
	const re = /--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) out[m[1]] = m[2];
	return out;
}

const merge = (bodies: string[]): Record<string, string> =>
	bodies.reduce<Record<string, string>>((acc, b) => ({ ...acc, ...colorTokens(b) }), {});

const LIGHT_SELECTOR = "html[data-theme='light']";

const kit = stripComments(readFileSync(KIT_CSS, 'utf8'));
const app = stripComments(readFileSync(APP_CSS, 'utf8'));

const kitBase = merge(blocks(kit, '@theme'));
const kitLight = merge(blocks(kit, LIGHT_SELECTOR));
const appBase = merge(blocks(app, ':root'));
const appLight = merge(blocks(app, LIGHT_SELECTOR));

/**
 * Cascade order. The kit emits its base palette at :root and its light palette
 * at html[data-theme='light'], which outranks :root on specificity. So a :root
 * rule in app.css only reaches a token the light blocks leave alone.
 */
const PALETTES: Record<'dark' | 'light', Record<string, string>> = {
	dark: { ...kitBase, ...appBase },
	light: { ...kitBase, ...appBase, ...kitLight, ...appLight },
};

// Contrast maths (WCAG 2.1 relative luminance)

const channels = (hex: string): [number, number, number] => {
	const h = hex.replace('#', '');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

const luminance = (hex: string): number => {
	const [r, g, b] = channels(hex).map((c) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

/**
 * Tailwind's `/NN` opacity modifier lands as a translucent fill that the
 * browser composites over the backdrop in sRGB, so a tinted chip reads against
 * the blend, not against the canvas underneath it.
 */
const composite = (fg: string, alpha: number, bg: string): string => {
	const f = channels(fg);
	const b = channels(bg);
	const hex = f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
	return '#' + hex.map((v) => v.toString(16).padStart(2, '0')).join('');
};

// The pairs the admin actually paints

const CANVASES = ['ink', 'surface', 'surface-2'] as const;

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** Foreground token read directly on every canvas the admin uses. */
const ON_CANVAS: ReadonlyArray<readonly [token: string, bar: number, note: string]> = [
	['fg', AA_TEXT, 'body copy'],
	['muted', AA_TEXT, 'secondary copy and labels'],
	['faint', AA_TEXT, 'captions and metadata'],
	['brand', AA_TEXT, 'links and brand text'],
	['brand-light', AA_TEXT, 'link and button hover'],
	['brand-deep', AA_TEXT, 'deep brand text'],
	['violet', AA_TEXT, 'kit accent text'],
	['success', AA_TEXT, 'status text'],
	['warn', AA_TEXT, 'status text'],
	['danger', AA_TEXT, 'error text'],
];

/** Token used as text inside a tint of itself, e.g. bg-warn/15 text-warn. */
const ON_OWN_TINT: ReadonlyArray<readonly [token: string, alpha: number, bar: number]> = [
	['brand', 0.1, AA_TEXT],
	['brand', 0.15, AA_NON_TEXT], // icon chips only
	['brand', 0.2, AA_TEXT], // badge hover
	['violet', 0.1, AA_TEXT],
	['success', 0.1, AA_TEXT],
	['warn', 0.1, AA_TEXT],
	['warn', 0.15, AA_TEXT],
	['danger', 0.1, AA_TEXT],
	['danger', 0.15, AA_TEXT],
];

/** ink-colored text on a filled token field, e.g. bg-brand text-ink. */
const FILLED: ReadonlyArray<readonly [field: string, alpha: number, bar: number]> = [
	['brand', 1, AA_TEXT],
	['brand-light', 1, AA_TEXT],
	['violet', 1, AA_TEXT],
	['danger', 1, AA_TEXT],
];

/** Solid token used as a dot or bar, judged as a graphical object. */
const GRAPHICAL: readonly string[] = ['brand', 'success', 'warn', 'danger'];

describe.each(['dark', 'light'] as const)('%s palette', (mode) => {
	const p = PALETTES[mode];

	it('resolves every token the pairs below reference', () => {
		const needed = new Set([
			...CANVASES,
			...ON_CANVAS.map(([t]) => t),
			...ON_OWN_TINT.map(([t]) => t),
			...FILLED.map(([t]) => t),
			...GRAPHICAL,
			'ink',
		]);
		for (const t of needed) expect(p[t], `token --color-${t} is undefined`).toMatch(/^#[0-9a-f]{6}$/i);
	});

	describe.each(ON_CANVAS)('%s on each canvas', (token, bar, note) => {
		it.each(CANVASES)(`clears ${'%s'} (${note})`, (canvas) => {
			const ratio = contrast(p[token], p[canvas]);
			expect(ratio, `${token} on ${canvas} is ${ratio.toFixed(2)}:1, needs ${bar}:1`).toBeGreaterThanOrEqual(bar);
		});
	});

	describe.each(ON_OWN_TINT)('%s inside a %f tint of itself', (token, alpha, bar) => {
		it.each(CANVASES)('clears %s', (canvas) => {
			const bg = composite(p[token], alpha, p[canvas]);
			const ratio = contrast(p[token], bg);
			expect(
				ratio,
				`${token} on bg-${token}/${alpha * 100} over ${canvas} is ${ratio.toFixed(2)}:1, needs ${bar}:1`,
			).toBeGreaterThanOrEqual(bar);
		});
	});

	it.each(FILLED)('ink text on a filled %s field at alpha %f', (field, alpha, bar) => {
		const fg = composite(p.ink, alpha, p[field]);
		const ratio = contrast(fg, p[field]);
		expect(
			ratio,
			`text-ink${alpha < 1 ? `/${alpha * 100}` : ''} on bg-${field} is ${ratio.toFixed(2)}:1, needs ${bar}:1`,
		).toBeGreaterThanOrEqual(bar);
	});

	describe.each(GRAPHICAL)('%s as a dot or progress bar', (token) => {
		it.each(CANVASES)('clears %s', (canvas) => {
			const ratio = contrast(p[token], p[canvas]);
			expect(
				ratio,
				`bg-${token} on ${canvas} is ${ratio.toFixed(2)}:1, needs ${AA_NON_TEXT}:1`,
			).toBeGreaterThanOrEqual(AA_NON_TEXT);
		});
	});
});

describe('palette wiring', () => {
	it('declares the light palette behind the attribute the toggle sets', () => {
		// The kit owns both palettes.
		expect(Object.keys(kitLight).length).toBeGreaterThan(0);
		expect(kit).toContain(LIGHT_SELECTOR);
	});

	it('overrides no palette token of its own', () => {
		// Not a style preference. A correction that lives in one consumer is a
		// correction the other consumers do not get, so anything the admin needs
		// to change about the palette belongs upstream in the kit.
		const overridden = [...Object.keys(appBase), ...Object.keys(appLight)];
		expect(overridden, 'move these into @lyeve-labs/ui-kit instead').toEqual([]);
	});

	it('keeps the two palettes distinct', () => {
		const differing = Object.keys(PALETTES.dark).filter((k) => PALETTES.dark[k] !== PALETTES.light[k]);
		expect(differing.length).toBeGreaterThan(5);
	});
});
