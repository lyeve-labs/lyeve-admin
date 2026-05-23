/**
 * How the content index can be ordered, and which way each key reads first.
 *
 * A name reads A to Z. A count reads largest first, because the question
 * behind sorting by rows is "which collections hold the data", and an
 * ascending answer to that is a page of zeros. A change date reads newest
 * first for the same reason.
 */
export const COLLECTION_SORTS = {
	name: 'asc',
	rows: 'desc',
	fields: 'desc',
	updated: 'desc'
} as const;

export type CollectionSort = keyof typeof COLLECTION_SORTS;
export type SortDir = 'asc' | 'desc';

export function isCollectionSort(v: string | null): v is CollectionSort {
	return v !== null && v in COLLECTION_SORTS;
}

/** The sort a request asked for, falling back to name order. */
export function sortFromParams(params: URLSearchParams): { sort: CollectionSort; dir: SortDir } {
	const raw = params.get('sort');
	const sort: CollectionSort = isCollectionSort(raw) ? raw : 'name';
	const asked = params.get('dir');
	const dir: SortDir = asked === 'asc' || asked === 'desc' ? asked : COLLECTION_SORTS[sort];
	return { sort, dir };
}

/**
 * The subsets the index can be narrowed to, and the label each chip carries.
 *
 * The options a collection was made with are the facts an operator narrows
 * by when looking for the one that behaves a certain way, and whether it
 * holds anything is the question behind most visits. `empty` and `with-rows`
 * cost a stats read per collection in the set, the same price as sorting by
 * rows, so they are the only two that read past the page.
 */
export const COLLECTION_FILTERS = {
	all: 'All',
	'with-rows': 'With rows',
	empty: 'Empty',
	'draft-publish': 'Draft and publish',
	localized: 'Localized',
	'soft-delete': 'Soft delete'
} as const;

export type CollectionFilter = keyof typeof COLLECTION_FILTERS;

export function isCollectionFilter(v: string | null): v is CollectionFilter {
	return v !== null && v in COLLECTION_FILTERS;
}

/** The filter a request asked for, falling back to the whole set. */
export function filterFromParams(params: URLSearchParams): CollectionFilter {
	const raw = params.get('filter');
	return isCollectionFilter(raw) ? raw : 'all';
}

/** Whether a filter can only be answered by counting the rows of every collection in the set. */
export function filterCountsRows(filter: CollectionFilter): boolean {
	return filter === 'empty' || filter === 'with-rows';
}
