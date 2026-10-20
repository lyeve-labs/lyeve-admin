// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { outlineSkips } from './test-outline';

function outline(html: string): string[] {
	const root = document.createElement('div');
	root.innerHTML = html;
	return outlineSkips(root);
}

describe('outlineSkips', () => {
	it('reports a step down of more than one level, and allows any step up', () => {
		expect(outline('<h1>Page</h1><h3>Section</h3>')).toEqual(['h1 to h3: Section']);
		expect(outline('<h1>Page</h1><h2>A</h2><h3>B</h3><h2>C</h2>')).toEqual([]);
	});

	it('leaves out a heading the reader cannot reach', () => {
		expect(outline('<h1>Page</h1><div inert><h3>Closed</h3></div><h2>Open</h2>')).toEqual([]);
		expect(outline('<h1>Page</h1><div aria-hidden="true"><h3>Decor</h3></div>')).toEqual([]);
	});

	it('leaves out a heading hidden by the hidden class until a wider screen', () => {
		expect(outline('<h1>Page</h1><h3 class="hidden sm:block">Wide only</h3><h2>Body</h2>')).toEqual([]);
	});
});
