import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';

/**
* Svelte's server renderer stamps `onload="this.__e=event"` and
* `onerror="this.__e=event"` onto a set of elements so hydration can replay
* load and error events that fired before it ran. Consumers serve this kit
* under a `script-src` policy carrying a nonce and no `unsafe-inline`, where a
* nonce never covers an event handler attribute, so the browser refuses to run
* either one and logs a violation for every element rendered. Hydration then
* removes the attributes, so nothing in the live DOM says where it came from.
*
* A component author has no way to guess that adding `use:` to an `<img>` is a
* CSP change, so the rule is checked here rather than left to review. Attach
* from a wrapper element instead, as Avatar does.
*/
const REPLAYED = new Set([
	'body',
	'embed',
	'iframe',
	'img',
	'link',
	'object',
	'script',
	'style',
	'track',
]);

/**
* The three shapes that trigger it. A spread and a `use:` directive each add
* both attributes because the compiler cannot see what they contain. An
* `onload` or `onerror` handler adds the one it names. Any other event
* handler, `onclick` included, is left alone.
*/
function replayTriggers(attributes: Array<{ type: string; name?: string }>): string[] {
	const found: string[] = [];
	for (const attribute of attributes) {
		if (attribute.type === 'SpreadAttribute') found.push('a spread');
		else if (attribute.type === 'UseDirective') found.push(`use:${attribute.name ?? ''}`);
		else if (
			attribute.type === 'Attribute' &&
			(attribute.name === 'onload' || attribute.name === 'onerror')
		) {
			found.push(attribute.name);
		}
	}
	return found;
}

function svelteFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) svelteFiles(path, out);
		else if (entry.endsWith('.svelte')) out.push(path);
	}
	return out;
}

function offendersIn(source: string, path: string): string[] {
	// The component's own script and style sections parse into `instance`,
	// `module` and `css`, so walking the fragment leaves them out and only
	// rendered markup is checked.
	const ast = parse(source, { modern: true, filename: path });
	const offenders: string[] = [];

	const walk = (node: unknown): void => {
		if (!node || typeof node !== 'object') return;
		const candidate = node as { type?: string; name?: string; attributes?: unknown };
		if (candidate.type === 'RegularElement' && REPLAYED.has(candidate.name ?? '')) {
			const triggers = replayTriggers(
				(candidate.attributes ?? []) as Array<{ type: string; name?: string }>,
			);
			if (triggers.length > 0) {
				offenders.push(`${path}: <${candidate.name}> carries ${triggers.join(', ')}`);
			}
		}
		for (const value of Object.values(node as Record<string, unknown>)) {
			if (Array.isArray(value)) value.forEach(walk);
			else if (
				value &&
				typeof value === 'object' &&
				typeof (value as { type?: unknown }).type === 'string'
			) {
				walk(value);
			}
		}
	};

	walk((ast as { fragment: unknown }).fragment);
	return offenders;
}

describe('server-rendered markup', () => {
	it('never puts an inline event handler on an element whose events get replayed', () => {
		const offenders = svelteFiles('src').flatMap((path) =>
			offendersIn(readFileSync(path, 'utf8'), path),
		);

		expect(offenders).toEqual([]);
	});

	it('recognizes each of the three shapes that trigger it', () => {
		const spread = '<img {...rest} />';
		const directive = '<img src="a.png" use:track />';
		const handler = '<img src="a.png" onerror={fail} />';
		const harmless = '<img src="a.png" onclick={pick} /><div use:track {...rest}></div>';

		expect(offendersIn(spread, 'spread.svelte')).toHaveLength(1);
		expect(offendersIn(directive, 'directive.svelte')).toHaveLength(1);
		expect(offendersIn(handler, 'handler.svelte')).toHaveLength(1);
		expect(offendersIn(harmless, 'harmless.svelte')).toEqual([]);
	});
});
