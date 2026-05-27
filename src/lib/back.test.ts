import { describe, expect, it } from 'vitest';
import { listBack, listQuery } from './back';

describe('listBack', () => {
	it('returns the bare list when the detail URL carries no filter', () => {
		const url = new URL('http://localhost/admin/flows/f1');
		expect(listBack('/admin/flows', 'Flows', url, ['status', 'q'])).toEqual({
			href: '/admin/flows',
			label: 'Flows',
		});
	});

	it('forwards only the named keys, in their order, and drops empty ones', () => {
		const url = new URL('http://localhost/admin/flows/f1?q=sync&status=active&stray=1&limit=');
		expect(listBack('/admin/flows', 'Flows', url, ['status', 'q', 'limit']).href).toBe(
			'/admin/flows?status=active&q=sync',
		);
	});

	it('keeps a value that needs escaping intact', () => {
		const url = new URL('http://localhost/admin/flows/f1?q=a%26b');
		expect(listBack('/admin/flows', 'Flows', url, ['q']).href).toBe('/admin/flows?q=a%26b');
	});
});

describe('listQuery', () => {
	it('is empty when nothing is set', () => {
		expect(listQuery({ status: '', q: null, offset: undefined })).toBe('');
	});

	it('names every set filter, numbers included', () => {
		expect(listQuery({ status: 'active', q: '', limit: 25, offset: 50 })).toBe(
			'?status=active&limit=25&offset=50',
		);
	});
});
