/**
 * What a tenant logo or tab icon upload accepts, read by the drop zone before
 * it sends anything and by the action again before the engine sees the file.
 *
 * PNG, JPEG and WebP only. The media library refuses SVG outright, and its
 * public route would hand one back as an attachment under a sandbox, so an
 * SVG logo is reachable only as an https address the tenant hosts itself.
 * 500 KB: the header draws the logo on every page of the admin, and the
 * upload rides a form post, which the server caps at 512 KiB by default.
 */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LOGO_ACCEPT = LOGO_TYPES.join(',');
export const LOGO_MAX_BYTES = 500_000;

/**
 * Why a file cannot be the logo, or null when it can. The tab icon takes the
 * same files and passes its own noun.
 */
export function logoProblem(file: { type: string; size: number }, noun = 'logo'): string | null {
	if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return `A ${noun} is a PNG, JPEG or WebP image.`;
	if (file.size === 0) return 'That file is empty.';
	if (file.size > LOGO_MAX_BYTES) return `A ${noun} is at most 500 KB.`;
	return null;
}

/**
 * Whether the first bytes of a file are the image its type claims. A file
 * renamed to .png keeps its own first bytes, so the name and the declared
 * type prove nothing on their own.
 */
export function logoBytesMatch(type: string, head: Uint8Array): boolean {
	const starts = (sig: number[], at = 0) => sig.every((b, i) => head[at + i] === b);
	switch (type) {
		case 'image/png':
			return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		case 'image/jpeg':
			return starts([0xff, 0xd8, 0xff]);
		case 'image/webp':
			return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
		default:
			return false;
	}
}

/** A logo address the engine accepts: https, or a published library file. */
export function logoAddressOk(url: string): boolean {
	return /^https:\/\/[^\s"'<>]+$/.test(url) || /^\/api\/v1\/media\/[^\s"'<>]+$/.test(url);
}
