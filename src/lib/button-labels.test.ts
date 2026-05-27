import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * One vocabulary for the buttons that write. The header action reads
 * "New <noun>", the drawer's primary reads "Create" on a new row and "Save"
 * on an existing one, the secondary reads "Cancel" and the destructive one
 * reads "Delete". One set of words reads as one product, so the same gesture
 * never reads two ways on pages one click apart. A label that opens a repeating row inside a form ("Add header",
 * "Add field") is not a write and is not covered.
 */
const FORBIDDEN: RegExp[] = [
	/^Update$/,
	/^Add$/,
	/^Submit$/,
	/^Created$/,
	/^Remove$/,
	/^Save changes$/,
	/^Generate Key$/i,
	/^Create (a |first |new )?\S/i,
	/^Add a\b/,
	/^Add (role|provider|webhook|variable|price|tenant|user|key|job|entry|first entry|flow|datasource|schema)$/i,
];

/** The text a Button renders, with tags and template expressions taken out. */
function labelOf(inner: string): string {
	return inner
		.replace(/<[^>]+>/g, ' ')
		.replace(/\{[^}]*\}/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function offenders(): string[] {
	const out: string[] = [];
	// The signed-out pages are a card outside the shell and name the one thing
	// they do. The vocabulary is the admin's.
	for (const file of globSync('src/**/*.svelte').sort()) {
		if (file.endsWith('.test.svelte') || /^src\/routes\/(login|setup)\//.test(file)) continue;
		const src = readFileSync(file, 'utf8');
		for (const match of src.matchAll(/<Button\b[^>]*>([\s\S]*?)<\/Button>/g)) {
			const label = labelOf(match[1]);
			if (label && FORBIDDEN.some((re) => re.test(label))) out.push(`${file}: "${label}"`);
		}
	}
	return out;
}

describe('button vocabulary', () => {
	it('uses New, Create, Save, Cancel and Delete, and none of the refused labels', () => {
		expect(offenders()).toEqual([]);
	});

	it('reads the label through the icon and the expression around it', () => {
		expect(labelOf('<Plus size={14} /> New user')).toBe('New user');
		expect(labelOf("{editing ? 'Save' : 'Create'}")).toBe('');
	});
});
