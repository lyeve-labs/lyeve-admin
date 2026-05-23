import { describe, expect, it } from 'vitest';
import {
	pageNumber,
	pageOf,
	pageOffset,
	pageWindow,
	pastEndOffset,
	rowsOf,
	statedTotal,
	withOffset
} from './list';

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` }));

/*
 * A list without a limit renders whatever the endpoint returns, so every list
 * here pages.
 */
describe('statedTotal', () => {
	it('reads the count the envelope states', () => {
		expect(statedTotal({ data: rows(2), total_count: 900 })).toBe(900);
	});

	it('accepts the audit log spelling of the same count', () => {
		expect(statedTotal({ data: rows(2), total: 41 })).toBe(41);
	});

	// totalOf answers the page length here, which is the right answer for a
	// caller printing a number and the wrong one for a pager: it would report
	// 100 on page one of ten thousand and conclude the list had ended.
	it('says nothing rather than falling back to the page length', () => {
		expect(statedTotal(rows(100))).toBeNull();
		expect(statedTotal({ data: rows(100) })).toBeNull();
		expect(statedTotal(null)).toBeNull();
	});
});

describe('rowsOf', () => {
	it('takes a bare array as the rows', () => {
		expect(rowsOf(rows(3))).toHaveLength(3);
	});

	it('takes the data member of an envelope', () => {
		expect(rowsOf({ data: rows(3) })).toHaveLength(3);
	});

	it('answers empty for a response that failed', () => {
		expect(rowsOf(null)).toEqual([]);
		expect(rowsOf({ data: null })).toEqual([]);
	});
});

describe('pageOf', () => {
	it('never renders the probe row', () => {
		const page = pageOf(rows(26), 25, 0);

		expect(page.rows).toHaveLength(25);
		expect(page.hasMore).toBe(true);
	});

	it('reports the end of the list when the probe row is absent', () => {
		expect(pageOf(rows(25), 25, 0).hasMore).toBe(false);
		expect(pageOf(rows(4), 25, 0).hasMore).toBe(false);
	});

	it('prefers a stated count over the probe', () => {
		const page = pageOf({ data: rows(25), total_count: 900 }, 25, 0);

		expect(page.total).toBe(900);
		expect(page.hasMore).toBe(true);
	});

	it('knows the last page of a counted list', () => {
		const page = pageOf({ data: rows(10), total_count: 60 }, 25, 50);

		expect(page.hasMore).toBe(false);
	});

	// An endpoint that ignores limit and offset entirely still gets bounded,
	// because the slice happens on this side of the call.
	it('bounds a response that ignored the window it was given', () => {
		const page = pageOf(rows(10_000), 50, 0);

		expect(page.rows).toHaveLength(50);
		expect(page.hasMore).toBe(true);
	});

	it('states no total when the response stated none', () => {
		expect(pageOf(rows(26), 25, 0).total).toBeNull();
	});
});

describe('pageWindow', () => {
	const at = (search: string) => new URL(`http://localhost/admin/media${search}`);

	it('falls back when the request names no window', () => {
		expect(pageWindow(at(''), 60, 199)).toEqual({ limit: 60, offset: 0 });
	});

	it('reads the window the request named', () => {
		expect(pageWindow(at('?limit=10&offset=30'), 60, 199)).toEqual({ limit: 10, offset: 30 });
	});

	// The engine clamps an oversized limit rather than refusing it, so a request
	// past the ceiling comes back truncated and the caller cannot tell a full
	// page from a short one. Clamping here means the number asked for is the
	// number the answer can be read against.
	it('clamps a limit past the ceiling', () => {
		expect(pageWindow(at('?limit=100000'), 60, 199).limit).toBe(199);
	});

	it('refuses a limit of zero and a negative offset', () => {
		expect(pageWindow(at('?limit=0&offset=-5'), 60, 199)).toEqual({ limit: 60, offset: 0 });
	});

	it('ignores a window that is not a number', () => {
		expect(pageWindow(at('?limit=all&offset=first'), 60, 199)).toEqual({ limit: 60, offset: 0 });
	});

	// The offset is user input from a URL and the pager counts in pages, so an
	// offset between two boundaries is a window the pager cannot name: it would
	// state the range of the page it rounds to while the rows on screen started
	// somewhere else. Snapping down hides nothing, because the page below an
	// arbitrary offset holds every row that offset would have shown.
	it('snaps an offset between two pages down to the page it falls in', () => {
		expect(pageWindow(at('?limit=50&offset=30'), 60, 199)).toEqual({ limit: 50, offset: 0 });
		expect(pageWindow(at('?limit=50&offset=130'), 60, 199)).toEqual({ limit: 50, offset: 100 });
	});
});

describe('page arithmetic', () => {
	it('names the page a window starts on', () => {
		expect(pageNumber(0, 50)).toBe(1);
		expect(pageNumber(50, 50)).toBe(2);
		expect(pageNumber(12300, 60)).toBe(206);
	});

	it('answers page one for a window no request could have asked for', () => {
		expect(pageNumber(-40, 50)).toBe(1);
		expect(pageOffset(0, 50)).toBe(0);
		expect(pageOffset(-3, 50)).toBe(0);
	});

	it('round trips a page through its offset', () => {
		for (const page of [1, 2, 7, 206]) {
			expect(pageNumber(pageOffset(page, 60), 60)).toBe(page);
		}
	});
});

/*
 * An empty page is not an empty collection. All four of these lists draw one
 * empty state for both, and it says the collection is empty and offers no
 * control to leave with, so an offset past the end would tell an operator their
 * files are gone and leave them there.
 */
describe('pastEndOffset', () => {
	it('leaves a page that has rows alone', () => {
		expect(pastEndOffset(60, 60, 120, 900)).toBeNull();
	});

	// Page one is the answer to an empty collection, not a window to correct.
	it('leaves an empty first page alone', () => {
		expect(pastEndOffset(0, 60, 0, 0)).toBeNull();
		expect(pastEndOffset(0, 60, 0, null)).toBeNull();
	});

	it('sends a counted list back to the last page that holds rows', () => {
		expect(pastEndOffset(0, 60, 600, 125)).toBe(120);
		expect(pastEndOffset(0, 60, 600, 120)).toBe(60);
	});

	// Without a total there is no last page to name here, so the first is the
	// only window this can be sure holds anything.
	it('sends an uncounted list back to the first page', () => {
		expect(pastEndOffset(0, 60, 600, null)).toBe(0);
	});

	it('sends an emptied collection back to its first page', () => {
		expect(pastEndOffset(0, 60, 120, 0)).toBe(0);
	});

	// A total that disagrees with the rows would otherwise redirect to the
	// window it was already on, and every load would redirect again.
	it('renders rather than bouncing when the target is the current window', () => {
		expect(pastEndOffset(0, 60, 60, 100)).toBeNull();
	});
});

describe('withOffset', () => {
	it('keeps every other parameter', () => {
		const url = new URL('https://admin.test/admin/content?q=post&limit=50&offset=200');
		expect(withOffset(url, 0)).toBe('/admin/content?q=post&limit=50&offset=0');
	});

	it('states an offset the request left out', () => {
		expect(withOffset(new URL('https://admin.test/admin/media'), 0)).toBe('/admin/media?offset=0');
	});
});
