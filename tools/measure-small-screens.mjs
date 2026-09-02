#!/usr/bin/env node
/**
 * Render every admin route at phone, tablet and desktop width against a
 * running instance, measure what the layout does with the room it has, and
 * save one screenshot per page per width.
 *
 *   ADMIN_URL=http://localhost:5173 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *     pnpm measure:small-screens [--out <dir>] [--widths 400,768,1280] [--only <substring>]
 *
 * Environment:
 *   ADMIN_URL          the admin dev server (default http://localhost:5173)
 *   ADMIN_EMAIL        an admin account on the instance behind it
 *   ADMIN_PASSWORD     its password
 *   PLAYWRIGHT_DIR     a directory whose node_modules holds playwright or
 *                      @playwright/test, when this repository does not (it is
 *                      not a dependency here)
 *   BROWSER_CHANNEL    'chrome' to drive an installed Chrome instead of the
 *                      browser playwright downloads
 *
 * A page that fits at 1280px says nothing about 400px. The checks are DOM measurements rather
 * than a person's eye, so the same list reruns after a fix and reports the
 * delta: horizontal overflow, controls under the 44px target, text under
 * 12px, a table with no scroll box of its own, a flex row that refuses to
 * wrap, a dialog taller than the window with no inner scroll, a drawer that
 * cannot be closed, the primary action pushed off screen, and at desktop
 * width whether the title, the filter row and the first row of content all
 * land above a 720px fold.
 *
 * Dynamic routes take their parameter from the list page above them: the
 * first link on /admin/flows that points one segment deeper is the flow the
 * detail page renders. A list with no rows leaves its detail route
 * unmeasured and the report says so, rather than inventing an id.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
}

const ADMIN_URL = (process.env.ADMIN_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL ?? '';
const PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const OUT = path.resolve(flag('--out', path.join(tmpdir(), 'lyeve-admin-small-screens')));
const WIDTHS = flag('--widths', '400,768,1280')
	.split(',')
	.map((w) => Number(w))
	.filter((w) => w > 0);
const ONLY = flag('--only', '');

/** Viewport height per width: a phone is tall, the desktop fold is 720. */
const HEIGHT = { 400: 800, 768: 1024, 1280: 720 };

const require = createRequire(
	process.env.PLAYWRIGHT_DIR
		? path.join(path.resolve(process.env.PLAYWRIGHT_DIR), 'package.json')
		: import.meta.url,
);
// Either package exports the browser. A directory that runs tests may hold only
// the runner.
const { chromium } = (() => {
	try {
		return require('playwright');
	} catch {
		return require('@playwright/test');
	}
})();

/**
 * Every +page.svelte under src/routes, as a URL pattern. Route groups in
 * parentheses are dropped, because they are a filesystem convenience and not
 * a path segment.
 */
function routePatterns() {
	const out = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const full = path.join(dir, name);
			if (statSync(full).isDirectory()) walk(full);
			else if (name === '+page.svelte') {
				const rel = path.relative('src/routes', dir).split(path.sep);
				const segs = rel.filter((s) => s && !s.startsWith('('));
				out.push('/' + segs.join('/'));
			}
		}
	};
	walk('src/routes');
	return out.sort();
}

const PATTERNS = routePatterns();

/** Static sibling names at each level, so the resolver never mistakes /flows/variables for a flow id. */
function staticSiblings(prefixSegs) {
	const names = new Set();
	for (const p of PATTERNS) {
		const segs = p.split('/').filter(Boolean);
		if (segs.length <= prefixSegs.length) continue;
		if (prefixSegs.every((s, i) => segs[i] === s || segs[i].startsWith('['))) {
			const next = segs[prefixSegs.length];
			if (!next.startsWith('[')) names.add(next);
		}
	}
	return names;
}

const candidates = new Map();

/** Every value a list page offers for the dynamic segment under it, in page order. */
async function listCandidates(page, parent, skip) {
	const key = parent;
	if (!candidates.has(key)) {
		await page.goto(ADMIN_URL + parent, { waitUntil: 'networkidle' });
		const values = await page.evaluate(
			({ parent, skip }) => {
				const out = [];
				for (const a of document.querySelectorAll('main a[href]')) {
					const href = a.getAttribute('href') ?? '';
					if (!href.startsWith(parent + '/')) continue;
					const first = href.slice(parent.length + 1).split(/[?#/]/)[0];
					if (first && !skip.includes(first) && !out.includes(first)) out.push(first);
				}
				return out;
			},
			{ parent, skip: [...skip] },
		);
		candidates.set(key, values);
	}
	return candidates.get(key);
}

/**
 * Turn a pattern into a concrete path by reading the list page above each
 * dynamic segment. A list whose first entry leads nowhere deeper (a
 * collection with no rows) is not the end of it: the next few entries are
 * tried before the route is reported unresolved.
 */
async function resolvePath(page, pattern) {
	const segs = pattern.split('/').filter(Boolean);
	async function walk(i, concrete) {
		if (i === segs.length) return '/' + concrete.join('/');
		const seg = segs[i];
		if (!seg.startsWith('[')) return walk(i + 1, [...concrete, seg]);
		const parent = '/' + concrete.join('/');
		const values = await listCandidates(page, parent, staticSiblings(concrete));
		for (const value of values.slice(0, 5)) {
			const found = await walk(i + 1, [...concrete, value]);
			if (found) return found;
		}
		return null;
	}
	return walk(0, []);
}

/**
 * The measurements, run inside the page. Everything is a plain number or a
 * short list of offenders named by test id, aria-label or text, so the
 * report reads without the screenshot.
 */
function measure(width) {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const name = (el) => {
		const id = el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.getAttribute('name');
		const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
		return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${text ? ` "${text}"` : ''}`;
	};
	const visible = (el) => {
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return false;
		const cs = getComputedStyle(el);
		if (cs.visibility === 'hidden' || cs.display === 'none') return false;
		// A closed details keeps its content in the layout tree under
		// content-visibility, so a closed menu's items have a rect while nobody
		// can see or reach them. checkVisibility knows about that,
		// and about an opacity of zero.
		if (
			typeof el.checkVisibility === 'function' &&
			!el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
		) {
			return false;
		}
		// Screen-reader-only content is 1px by 1px on purpose.
		if (r.width <= 1 && r.height <= 1) return false;
		if (el.closest('.sr-only')) return false;
		// A collapsed nav group stays in the document at zero height, inert, so
		// its disclosure keeps a target. The rows inside keep their own rects.
		if (el.closest('[inert]')) return false;
		return true;
	};
	// The target a finger meets: the element's box, or the invisible hit box a
	// small control grows around itself under a coarse pointer (the kit's
	// hit-area utility, an absolutely positioned ::before with a minimum size).
	const box = (el) => {
		const r = el.getBoundingClientRect();
		const before = getComputedStyle(el, '::before');
		if (before.content === 'none' || before.position !== 'absolute') return { w: r.width, h: r.height };
		return {
			w: Math.max(r.width, parseFloat(before.minWidth) || 0),
			h: Math.max(r.height, parseFloat(before.minHeight) || 0),
		};
	};
	// A checkbox or radio inside its label is reached through the label, so
	// the label's box is the target when it is the larger.
	const target = (el) => {
		const own = box(el);
		const label = el.tagName === 'INPUT' ? el.closest('label') : null;
		if (!label) return own;
		const l = box(label);
		return { w: Math.max(own.w, l.w), h: Math.max(own.h, l.h) };
	};
	// The shell's main is itself a scroll region, so it is the boundary the
	// walk stops at: a table needs a box of its own inside it, and an element
	// that is only clipped by main is the overflow this measures.
	const main = document.querySelector('main');
	const hasScrollAncestor = (el) => {
		for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
			const ox = getComputedStyle(p).overflowX;
			if (ox === 'auto' || ox === 'scroll') return true;
		}
		return false;
	};

	// Overflow: the document, the shell's scroll region, and the widest element
	// that is not inside a scroll box of its own.
	const docOverflow = document.documentElement.scrollWidth - vw;
	const mainOverflow = main ? main.scrollWidth - main.clientWidth : 0;
	let widest = null;
	let widestRight = vw;
	for (const el of document.body.querySelectorAll('*')) {
		if (!visible(el)) continue;
		if (getComputedStyle(el).position === 'fixed') continue;
		const r = el.getBoundingClientRect();
		if (r.right > widestRight + 1 && !hasScrollAncestor(el)) {
			widestRight = r.right;
			widest = el;
		}
	}

	// Controls under the target size. Inline links inside a sentence are
	// exempt, as the success criterion exempts them.
	const controls = Array.from(
		document.querySelectorAll(
			'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"]',
		),
	).filter((el) => visible(el) && el.type !== 'hidden');
	const small = [];
	const tiny = [];
	for (const el of controls) {
		const cs = getComputedStyle(el);
		if (el.tagName === 'A' && cs.display === 'inline') continue;
		const r = target(el);
		const min = Math.min(r.w, r.h);
		if (min < 44) small.push({ name: name(el), w: Math.round(r.w), h: Math.round(r.h) });
		if (min < 24) tiny.push({ name: name(el), w: Math.round(r.w), h: Math.round(r.h) });
	}

	// Text under 12px: elements with a text node of their own.
	const tinyText = [];
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	const seen = new Set();
	while (walker.nextNode()) {
		const t = walker.currentNode;
		if (!t.textContent || !t.textContent.trim()) continue;
		const el = t.parentElement;
		if (!el || seen.has(el) || !visible(el)) continue;
		seen.add(el);
		const size = parseFloat(getComputedStyle(el).fontSize);
		if (size < 12) tinyText.push({ name: name(el), px: Math.round(size * 10) / 10 });
	}

	// Tables without a scroll box.
	const tables = Array.from(document.querySelectorAll('table')).filter(visible);
	const unscrolled = tables.filter((t) => !hasScrollAncestor(t)).map(name);

	// Flex rows that refuse to wrap and are already wider than their box.
	const rigid = [];
	for (const el of document.body.querySelectorAll('*')) {
		if (!visible(el)) continue;
		const cs = getComputedStyle(el);
		if (cs.display !== 'flex' && cs.display !== 'inline-flex') continue;
		if (cs.flexDirection !== 'row' && cs.flexDirection !== 'row-reverse') continue;
		if (cs.flexWrap !== 'nowrap') continue;
		if (el.scrollWidth <= el.clientWidth + 1) continue;
		if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
		if (!el.querySelector('button, a[href], input, select')) continue;
		rigid.push({ name: name(el), over: el.scrollWidth - el.clientWidth });
	}

	// Open dialogs taller than the window with nothing inside them scrolling.
	const tallDialogs = [];
	for (const d of document.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
		if (!visible(d)) continue;
		const r = d.getBoundingClientRect();
		if (r.height <= vh) continue;
		const scrolls = Array.from(d.querySelectorAll('*')).some((c) => {
			const oy = getComputedStyle(c).overflowY;
			return (oy === 'auto' || oy === 'scroll') && c.scrollHeight > c.clientHeight;
		});
		if (!scrolls) tallDialogs.push(name(d));
	}

	// The primary action: every control in the title row's actions (the last
	// one is the primary by convention, and any of them off the edge is a
	// finding), else the first submit button on the page.
	const title = document.querySelector('[data-testid="page-title"]');
	const header = title ? title.closest('header') : null;
	const slot = header ? header.querySelector('[data-testid="page-actions"]') : null;
	let actions = slot ? Array.from(slot.querySelectorAll('button, a[href]')) : [];
	if (actions.length === 0) {
		const submit = document.querySelector('main button[type="submit"], main form button');
		if (submit) actions = [submit];
	}
	let primaryAction = null;
	if (actions.length > 0) {
		const off = actions.filter((el) => {
			const r = el.getBoundingClientRect();
			return r.left < -1 || r.right > vw + 1;
		});
		const last = actions[actions.length - 1].getBoundingClientRect();
		primaryAction = {
			name: name(actions[actions.length - 1]),
			offscreenX: off.length > 0,
			offscreen: off.map(name),
			belowFold: last.top > vh,
		};
	}

	// Anything demanding more width than the window has.
	const minWidths = [];
	for (const el of document.body.querySelectorAll('*')) {
		const mw = parseFloat(getComputedStyle(el).minWidth);
		if (mw > vw && !hasScrollAncestor(el)) minWidths.push({ name: name(el), minWidth: mw });
	}

	// Desktop density: where the title, the filter row and the first row of
	// content sit against the fold. The content is the page shell's stack,
	// which is the last child of the frame the title row sits in. Its first
	// child with any height is the first thing the reader came for, and a
	// table inside it is measured by its first row rather than its frame.
	const toolbar = document.querySelector('main [role="toolbar"], main form');
	let firstRow = null;
	if (header) {
		const frame = header.parentElement && header.parentElement.parentElement;
		const stack = frame && frame.lastElementChild;
		if (stack) {
			for (const child of stack.children) {
				const r = child.getBoundingClientRect();
				if (r.height > 0) {
					firstRow = child.querySelector('tbody tr') || child;
					break;
				}
			}
		}
	}
	const density = {
		titleBottom: title ? Math.round(title.getBoundingClientRect().bottom) : null,
		toolbarBottom: toolbar ? Math.round(toolbar.getBoundingClientRect().bottom) : null,
		firstRow: firstRow ? name(firstRow) : null,
		firstRowTop: firstRow ? Math.round(firstRow.getBoundingClientRect().top) : null,
		firstRowBottom: firstRow ? Math.round(firstRow.getBoundingClientRect().bottom) : null,
	};

	return {
		width,
		url: location.pathname + location.search,
		title: document.title,
		docOverflow: Math.max(0, docOverflow),
		mainOverflow: Math.max(0, mainOverflow),
		widest: widest ? { name: name(widest), right: Math.round(widestRight) } : null,
		controls: controls.length,
		under44: small.length,
		under24: tiny,
		under44Sample: small.slice(0, 6),
		tinyText,
		tables: tables.length,
		unscrolledTables: unscrolled,
		rigidRows: rigid,
		tallDialogs,
		primaryAction,
		minWidths,
		density,
	};
}

/** Below md: open the shell's drawer and prove Escape and the close button both shut it. */
async function checkDrawer(page) {
	const open = page.getByRole('button', { name: 'Open navigation' });
	if ((await open.count()) === 0) return { present: false };
	await open.first().click();
	const dialog = page.locator('[role="dialog"][aria-label="Navigation"]');
	const opened = await dialog.isVisible().catch(() => false);
	if (!opened) return { present: true, opens: false, closes: false };
	await page.keyboard.press('Escape');
	const closedByKey = !(await dialog.isVisible().catch(() => false));
	if (!closedByKey) {
		const close = page.getByRole('button', { name: 'Close navigation' });
		if ((await close.count()) > 0) await close.first().click();
	}
	const closed = !(await dialog.isVisible().catch(() => false));
	return { present: true, opens: true, closedByEscape: closedByKey, closes: closed };
}

async function login(page) {
	await page.goto(ADMIN_URL + '/login', { waitUntil: 'networkidle' });
	if (!page.url().includes('/login')) return;
	await page.fill('input[name="email"]', EMAIL);
	await page.fill('input[name="password"]', PASSWORD);
	await Promise.all([
		page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
		page.click('button[type="submit"]'),
	]);
}

function slug(p) {
	return p.replace(/^\//, '').replace(/\//g, '__') || 'root';
}

async function main() {
	mkdirSync(OUT, { recursive: true });
	const browser = await chromium.launch(
		process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {},
	);
	const results = [];
	try {
		// One desktop context resolves the ids, then each width gets its own
		// context so the shell's mobile query is evaluated fresh per size.
		const resolver = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		const rpage = await resolver.newPage();
		await login(rpage);
		const paths = [];
		for (const pattern of PATTERNS) {
			if (ONLY && !pattern.includes(ONLY)) continue;
			const p = await resolvePath(rpage, pattern);
			paths.push({ pattern, path: p });
			if (!p) console.error(`unresolved ${pattern}: the list above it has no link to follow`);
		}
		const state = await resolver.storageState();
		await resolver.close();

		for (const width of WIDTHS) {
			const viewport = { width, height: HEIGHT[width] ?? 800 };
			// A phone and a tablet are touched: with hasTouch the browser answers
			// `pointer: coarse`, which is the query the kit's 44px targets key on.
			// Without it every width measures the mouse sizes and the count under
			// 44px cannot move.
			const hasTouch = width < 1024;
			const ctx = await browser.newContext({ viewport, hasTouch, storageState: state, colorScheme: 'dark' });
			// The signed-out pages redirect a signed-in reader away, so they are
			// rendered without the session.
			const anon = await browser.newContext({ viewport, hasTouch, colorScheme: 'dark' });
			const authed = await ctx.newPage();
			const guest = await anon.newPage();
			for (const { pattern, path: p } of paths) {
				const page = pattern.startsWith('/admin') ? authed : guest;
				if (!p) {
					results.push({ pattern, width, unresolved: true });
					continue;
				}
				const errors = [];
				const onError = (e) => errors.push(e.message);
				page.on('pageerror', onError);
				try {
					const resp = await page.goto(ADMIN_URL + p, { waitUntil: 'networkidle', timeout: 30000 });
					await page.waitForTimeout(250);
					const m = await page.evaluate(measure, width);
					m.status = resp ? resp.status() : null;
					m.pattern = pattern;
					m.errors = errors;
					await page.screenshot({ path: path.join(OUT, `${slug(pattern)}@${width}.png`) });
					if (width < 768) m.drawer = await checkDrawer(page);
					results.push(m);
				} catch (err) {
					results.push({ pattern, width, url: p, failed: String(err.message).split('\n')[0] });
				} finally {
					page.off('pageerror', onError);
				}
			}
			await ctx.close();
			await anon.close();
		}
	} finally {
		await browser.close();
	}

	writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
	report(results);
	console.log(`\nscreenshots and results.json in ${OUT}`);
}

/** A markdown table per width, findings only, so the terminal shows what to fix. */
function report(results) {
	for (const width of WIDTHS) {
		console.log(`\n## ${width}px\n`);
		console.log('| page | overflow | <44 | <24 | <12px | table no scroll | rigid row | tall dialog | primary | drawer | fold |');
		console.log('|---|---|---|---|---|---|---|---|---|---|---|');
		for (const r of results.filter((x) => x.width === width)) {
			if (r.unresolved) {
				console.log(`| ${r.pattern} | unresolved | | | | | | | | | |`);
				continue;
			}
			if (r.failed) {
				console.log(`| ${r.pattern} | failed: ${r.failed} | | | | | | | | | |`);
				continue;
			}
			const over = Math.max(r.docOverflow, r.mainOverflow);
			const overflow = over > 0 ? `+${over}px (${r.widest ? r.widest.name : '?'})` : 'none';
			const primary = r.primaryAction
				? r.primaryAction.offscreenX
					? 'off screen'
					: r.primaryAction.belowFold
						? 'below fold'
						: 'ok'
				: 'none';
			const drawer = r.drawer
				? r.drawer.present
					? r.drawer.closes
						? r.drawer.closedByEscape
							? 'ok'
							: 'no escape'
						: 'stuck'
					: 'absent'
				: '';
			// A table is judged by its first row's bottom edge. Anything else by
			// having at least a control's height above the fold.
			const fold =
				width >= 1280 && r.density.firstRowTop !== null
					? (r.density.firstRow.startsWith('tr') ? r.density.firstRowBottom : r.density.firstRowTop + 44) <= HEIGHT[1280]
						? `ok (${r.density.firstRowTop})`
						: `below (${r.density.firstRowTop})`
					: '';
			console.log(
				`| ${r.pattern} | ${overflow} | ${r.under44}/${r.controls} | ${r.under24.length} | ${r.tinyText.length} | ${r.unscrolledTables.length} | ${r.rigidRows.length} | ${r.tallDialogs.length} | ${primary} | ${drawer} | ${fold} |`,
			);
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
