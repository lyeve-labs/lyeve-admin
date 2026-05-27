import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
	it('reads headings, paragraphs, fenced code and both list kinds', () => {
		const blocks = parseMarkdown('# Title\n\nOne line\nsame paragraph\n\n```yaml\nname: x\n```\n\n- a\n- b\n\n1. c\n2) d\n');
		expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'code', 'list', 'list']);
		expect(blocks[1]).toEqual({ kind: 'paragraph', children: [{ kind: 'text', text: 'One line same paragraph' }] });
		expect(blocks[2]).toEqual({ kind: 'code', language: 'yaml', text: 'name: x' });
		expect(blocks[3]).toMatchObject({ ordered: false });
		expect((blocks[3] as { items: unknown[] }).items).toHaveLength(2);
		expect(blocks[4]).toMatchObject({ ordered: true });
	});

	it('keeps a tag in the text as text', () => {
		const blocks = parseMarkdown('<script>alert(1)</script> and <b>bold</b>');
		expect(blocks).toEqual([{ kind: 'paragraph', children: [{ kind: 'text', text: '<script>alert(1)</script> and <b>bold</b>' }] }]);
	});

	it('closes an unterminated fence at the end of the text', () => {
		expect(parseMarkdown('```\nopen')).toEqual([{ kind: 'code', language: '', text: 'open' }]);
	});
});

describe('parseInline', () => {
	it('reads code, strong, emphasis and a web link', () => {
		expect(parseInline('use `x`, **bold**, *em* and [docs](https://example.com/a)')).toEqual([
			{ kind: 'text', text: 'use ' },
			{ kind: 'code', text: 'x' },
			{ kind: 'text', text: ', ' },
			{ kind: 'strong', children: [{ kind: 'text', text: 'bold' }] },
			{ kind: 'text', text: ', ' },
			{ kind: 'em', children: [{ kind: 'text', text: 'em' }] },
			{ kind: 'text', text: ' and ' },
			{ kind: 'link', href: 'https://example.com/a', children: [{ kind: 'text', text: 'docs' }] },
		]);
	});

	it('leaves a link that is not http as text', () => {
		expect(parseInline('[x](javascript:alert(1))')).toEqual([{ kind: 'text', text: '[x](javascript:alert(1))' }]);
		expect(parseInline('[x](data:text/html,hi)')).toEqual([{ kind: 'text', text: '[x](data:text/html,hi)' }]);
	});
});
