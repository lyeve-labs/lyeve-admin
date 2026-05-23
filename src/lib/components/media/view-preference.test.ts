// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_VIEW_KEY, readMediaView, writeMediaView } from './view-preference';

beforeEach(() => localStorage.clear());
afterEach(() => {
	vi.restoreAllMocks();
});

describe('media view preference', () => {
	it('defaults to the grid when nothing was chosen', () => {
		expect(readMediaView()).toBe('grid');
	});

	it('reads back what was written', () => {
		writeMediaView('list');
		expect(localStorage.getItem(MEDIA_VIEW_KEY)).toBe('list');
		expect(readMediaView()).toBe('list');
	});

	it('ignores a value that names no view', () => {
		// A stale or hand-edited entry must not render a view that does not exist.
		localStorage.setItem(MEDIA_VIEW_KEY, 'carousel');
		expect(readMediaView()).toBe('grid');
	});

	it('answers the default when storage refuses to be read', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('SecurityError');
		});
		expect(readMediaView()).toBe('grid');
	});

	it('swallows a write that storage refuses', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
		expect(() => writeMediaView('list')).not.toThrow();
	});
});
