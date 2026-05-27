/**
 * Copies text to the clipboard, reporting whether it worked.
 *
 * `navigator.clipboard.writeText` rejects whenever the page lacks clipboard-write
 * permission, which covers a non-secure origin, a denied prompt and any
 * cross-origin iframe. Awaited bare, the rejection escapes the handler and the
 * button appears to do nothing, so this reports a boolean. Callers use it to
 * show a tick or a "copy failed" hint.
 *
 * Falls back to the legacy `execCommand('copy')` path, which still works in
 * contexts where the async API is blocked.
 */
export async function copyText(text: string): Promise<boolean> {
	if (!text) return false;

	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Fall through to the legacy path.
	}

	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
}
