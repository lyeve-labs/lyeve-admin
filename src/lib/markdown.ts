/**
 * A small Markdown reader for text a model wrote: headings, paragraphs,
 * fenced code, bullet and numbered lists, and inline code, emphasis and
 * links. It produces a tree the renderer walks with ordinary elements, so no
 * HTML the model wrote is ever injected: a tag in the text is text.
 */

export type Inline =
	| { kind: 'text'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'strong'; children: Inline[] }
	| { kind: 'em'; children: Inline[] }
	| { kind: 'link'; href: string; children: Inline[] };

export type Block =
	| { kind: 'heading'; level: 1 | 2 | 3 | 4; children: Inline[] }
	| { kind: 'paragraph'; children: Inline[] }
	| { kind: 'code'; language: string; text: string }
	| { kind: 'list'; ordered: boolean; items: Inline[][] };

/** Only a web link is rendered as one. Anything else stays as text. */
function safeHref(href: string): string | null {
	return /^https?:\/\/\S+$/i.test(href) ? href : null;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/;

export function parseInline(text: string): Inline[] {
	const out: Inline[] = [];
	// Adjacent text joins, so a token that turned out to be plain text does
	// not split the run it sits in.
	const push = (node: Inline) => {
		const last = out[out.length - 1];
		if (node.kind === 'text' && last?.kind === 'text') last.text += node.text;
		else out.push(node);
	};
	let rest = text;
	while (rest.length > 0) {
		const m = INLINE.exec(rest);
		if (!m || m.index === undefined) {
			push({ kind: 'text', text: rest });
			break;
		}
		if (m.index > 0) push({ kind: 'text', text: rest.slice(0, m.index) });
		const token = m[0];
		if (m[1]) push({ kind: 'code', text: token.slice(1, -1) });
		else if (m[2]) push({ kind: 'strong', children: parseInline(token.slice(2, -2)) });
		else if (m[3]) push({ kind: 'em', children: parseInline(token.slice(1, -1)) });
		else {
			const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
			const href = link ? safeHref(link[2]) : null;
			if (link && href) push({ kind: 'link', href, children: parseInline(link[1]) });
			else push({ kind: 'text', text: token });
		}
		rest = rest.slice(m.index + token.length);
	}
	return out;
}

export function parseMarkdown(source: string): Block[] {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const blocks: Block[] = [];
	let paragraph: string[] = [];

	const flush = () => {
		if (paragraph.length === 0) return;
		blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
		paragraph = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fence = /^```\s*(\w*)\s*$/.exec(line);
		if (fence) {
			flush();
			const body: string[] = [];
			i++;
			while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
			blocks.push({ kind: 'code', language: fence[1], text: body.join('\n') });
			continue;
		}
		const heading = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading) {
			flush();
			blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3 | 4, children: parseInline(heading[2]) });
			continue;
		}
		const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(line);
		if (item) {
			flush();
			const ordered = item[2] !== undefined;
			const last = blocks[blocks.length - 1];
			if (last?.kind === 'list' && last.ordered === ordered) last.items.push(parseInline(item[3]));
			else blocks.push({ kind: 'list', ordered, items: [parseInline(item[3])] });
			continue;
		}
		if (line.trim() === '') {
			flush();
			continue;
		}
		paragraph.push(line.trim());
	}
	flush();
	return blocks;
}
