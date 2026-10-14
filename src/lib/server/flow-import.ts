/**
 * What the two flow import forms share: the reading of a pasted or uploaded
 * definition into the shape the engine takes.
 */

export type ImportText = { content: string; format: 'json' | 'yaml' } | { file: File };

/**
 * The definition out of the form: the file when one was chosen, and the
 * textarea otherwise. A file is forwarded as it is and the engine sniffs its
 * format. A paste is named JSON when it parses as JSON and YAML otherwise, so
 * the engine's error names the format the reader meant.
 */
export async function readImportForm(data: FormData): Promise<ImportText | null> {
	const file = data.get('file');
	if (file instanceof File && file.size > 0) return { file };
	const content = String(data.get('text') ?? '').trim();
	if (!content) return null;
	let format: 'json' | 'yaml' = 'yaml';
	try {
		JSON.parse(content);
		format = 'json';
	} catch {
		format = 'yaml';
	}
	return { content, format };
}

/**
 * The media type to send an uploaded bundle as. A browser often reports an
 * empty type for a .yml file, and the engine answers 415 to anything it does
 * not accept, so the name decides and the first character settles the rest.
 */
export async function bundleContentType(file: File): Promise<string> {
	const name = file.name.toLowerCase();
	if (name.endsWith('.json')) return 'application/json';
	if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'application/yaml';
	const head = (await file.slice(0, 64).text()).trimStart();
	return head.startsWith('{') || head.startsWith('[') ? 'application/json' : 'application/yaml';
}
