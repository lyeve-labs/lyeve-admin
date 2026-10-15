import { describe, expect, it } from 'vitest';
import { decodeEntities, snippetParts } from './highlight';

describe('snippetParts', () => {
	it('decodes escaped markup around a match', () => {
		expect(snippetParts('&lt;img src=x onerror=alert(1)&gt; <mark>Lamp</mark> &amp; desk')).toEqual([
			{ text: '<img src=x onerror=alert(1)> ', mark: false },
			{ text: 'Lamp', mark: true },
			{ text: ' & desk', mark: false },
		]);
	});

	it('keeps an escaped mark tag as text', () => {
		expect(snippetParts('&lt;mark&gt;x&lt;/mark&gt; <mark>y</mark>')).toEqual([
			{ text: '<mark>x</mark> ', mark: false },
			{ text: 'y', mark: true },
		]);
	});

	it('marks the rest after an unclosed mark', () => {
		expect(snippetParts('a <mark>b')).toEqual([
			{ text: 'a ', mark: false },
			{ text: 'b', mark: true },
		]);
	});
});

describe('decodeEntities', () => {
	it('decodes quotes, numeric references and an escaped ampersand once', () => {
		expect(decodeEntities('&#34;a&#39; &quot;b&apos; &#x41;&#65; &amp;lt;')).toBe('"a\' "b\' AA &lt;');
	});

	it('leaves an unknown or invalid reference as written', () => {
		expect(decodeEntities('&nbsp; &#0; &#x110000; & alone')).toBe('&nbsp; &#0; &#x110000; & alone');
	});
});
