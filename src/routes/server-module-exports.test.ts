import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * SvelteKit reads a page or layout server module for a fixed set of names
 * and refuses the module at runtime when it exports anything else. Nothing
 * static catches that: vitest imports the module like any other, and
 * svelte-check types it, so a helper or constant exported for a test is a
 * green build and a 500 on the page. A shared value lives under src/lib and
 * the route imports it.
 */
const ALLOWED: Record<string, Set<string>> = {
	'+page.server.ts': new Set(['load', 'actions', 'prerender', 'ssr', 'csr', 'trailingSlash', 'config', 'entries']),
	'+layout.server.ts': new Set(['load', 'prerender', 'ssr', 'csr', 'trailingSlash', 'config']),
};

/** Runtime export names of a module: declarations, lists, default and star. Types are erased and do not count. */
export function runtimeExports(source: string): string[] {
	const names: string[] = [];
	const declaration = /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class|enum)\s+([A-Za-z_$][\w$]*)/gm;
	for (const m of source.matchAll(declaration)) names.push(m[1]);
	const list = /^export\s*\{([^}]*)\}/gm;
	for (const m of source.matchAll(list)) {
		for (const item of m[1].split(',')) {
			const name = item.trim();
			if (!name || name.startsWith('type ')) continue;
			names.push(name.split(/\s+as\s+/).pop() as string);
		}
	}
	if (/^export\s+default\b/m.test(source)) names.push('default');
	if (/^export\s+\*/m.test(source)) names.push('*');
	return names;
}

describe('page and layout server modules', () => {
	const files = [...globSync('src/routes/**/+page.server.ts'), ...globSync('src/routes/**/+layout.server.ts')].sort();

	it('exist', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('export only what SvelteKit reads', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const kind = file.slice(file.lastIndexOf('/') + 1);
			const allowed = ALLOWED[kind];
			for (const name of runtimeExports(readFileSync(file, 'utf8'))) {
				if (!allowed.has(name)) offenders.push(`${file}: ${name}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	/*
	 * A load returns data and an action returns a plain object or fail(). Neither
	 * may return a Response, and SvelteKit refuses one at runtime with "Data
	 * returned from action inside <route> is not serializable". The export check
	 * above reads names and cannot see a return value, and an action handing the
	 * engine's bytes back as a download is a valid Response, typed clean and
	 * tested green, and still a 500 on the button that reaches it.
	 *
	 * A download belongs in a +server.ts endpoint, which may return a Response
	 * and is where the other file routes here already live.
	 */
	it('never hand SvelteKit a Response', () => {
		const offenders = files.filter((file) => /\bnew Response\s*\(/.test(readFileSync(file, 'utf8')));
		expect(
			offenders,
			`a page or layout server module cannot return a Response; move the download to a +server.ts endpoint: ${offenders.join(', ')}`
		).toEqual([]);
	});
});

describe('runtimeExports', () => {
	it('names declarations, lists and default, and skips types', () => {
		const source = [
			"import type { PageServerLoad } from './$types';",
			'export const load: PageServerLoad = async () => ({});',
			'export async function helper() {}',
			'export type Shape = { a: string };',
			'export interface Other { b: number }',
			'const x = 1, y = 2;',
			'export { x as prerender, type Shape as S, y };',
			'export default x;',
		].join('\n');
		expect(runtimeExports(source)).toEqual(['load', 'helper', 'prerender', 'y', 'default']);
	});
});
