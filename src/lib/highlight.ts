/**
 * A search snippet is HTML in which the document text is escaped and the only
 * live tags are the `<mark>` pairs around each match. The page splits it on
 * those tags and decodes each piece, then renders the pieces as text and the
 * matches in a real `<mark>`, so the snippet is never rendered as HTML.
 */
export interface SnippetPart {
	text: string;
	mark: boolean;
}

const named = new Map([
	['amp', '&'],
	['lt', '<'],
	['gt', '>'],
	['quot', '"'],
	['apos', "'"],
]);

/** Decodes the entities an HTML escaper writes, in one pass. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
		if (body[0] === '#') {
			const hex = body[1] === 'x' || body[1] === 'X';
			const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
		}
		return named.get(body.toLowerCase()) ?? entity;
	});
}

/** Splits a snippet on its mark tags into decoded plain and marked parts. */
export function snippetParts(snippet: string): SnippetPart[] {
	const out: SnippetPart[] = [];
	let rest = snippet;
	while (rest.length > 0) {
		const open = rest.indexOf('<mark>');
		if (open === -1) {
			out.push({ text: rest, mark: false });
			break;
		}
		if (open > 0) out.push({ text: rest.slice(0, open), mark: false });
		const after = rest.slice(open + '<mark>'.length);
		const close = after.indexOf('</mark>');
		if (close === -1) {
			out.push({ text: after, mark: true });
			break;
		}
		out.push({ text: after.slice(0, close), mark: true });
		rest = after.slice(close + '</mark>'.length);
	}
	return out.map((part) => ({ text: decodeEntities(part.text), mark: part.mark })).filter((part) => part.text.length > 0);
}
