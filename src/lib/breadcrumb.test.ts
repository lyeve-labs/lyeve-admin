import { describe, expect, it } from 'vitest';
import { crumbsAfter } from './breadcrumb';

const trail = [
	{ label: 'Content', href: '/admin/content' },
	{ label: 'Posts', href: '/admin/content/posts' },
	{ label: 'New entry' },
];

/*
 * The back link and the breadcrumb share a row, so a page would name its
 * parent on both. The trail starts after the crumb the back link already is.
 */
describe('crumbsAfter', () => {
	it('drops the crumbs up to and including the back target', () => {
		expect(crumbsAfter({ href: '/admin/content/posts', label: 'Posts' }, trail)).toEqual([{ label: 'New entry' }]);
		expect(crumbsAfter({ href: '/admin/content', label: 'Content' }, trail)).toEqual(trail.slice(1));
	});

	it('compares the path only, so a back link carrying the list query still matches', () => {
		expect(crumbsAfter({ href: '/admin/content/posts?limit=100&offset=200', label: 'Posts' }, trail)).toEqual([
			{ label: 'New entry' },
		]);
	});

	it('keeps the whole trail when the back link is not on it, or there is none', () => {
		expect(crumbsAfter({ href: '/admin/settings', label: 'Settings' }, trail)).toEqual(trail);
		expect(crumbsAfter(undefined, trail)).toEqual(trail);
	});
});
