/**
 * The library view a viewer last chose, kept in this browser only.
 *
 * A view is a reading preference and not a fact about the library, so it
 * lives with the viewer rather than in the URL: a copied link to the library
 * opens the way the recipient reads it, not the way the sender does. Storage
 * can be absent, full or refused, and every one of those is answered with the
 * default rather than an error, because a preference that cannot be saved is
 * a preference the page still has to render.
 */

export type MediaView = 'grid' | 'list';

export const MEDIA_VIEW_KEY = 'lyeve-media-view';

const DEFAULT_VIEW: MediaView = 'grid';

function isView(value: unknown): value is MediaView {
	return value === 'grid' || value === 'list';
}

export function readMediaView(): MediaView {
	try {
		const stored = localStorage.getItem(MEDIA_VIEW_KEY);
		return isView(stored) ? stored : DEFAULT_VIEW;
	} catch {
		return DEFAULT_VIEW;
	}
}

export function writeMediaView(view: MediaView): void {
	try {
		localStorage.setItem(MEDIA_VIEW_KEY, view);
	} catch {
		// Private mode or a full quota. The page keeps the view for this visit.
	}
}
