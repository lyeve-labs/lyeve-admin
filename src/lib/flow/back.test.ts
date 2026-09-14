import { describe, expect, it } from 'vitest';
import { flowBack, fromFlow } from './back';

describe('fromFlow', () => {
	it('carries the flow id on the shortcut', () => {
		expect(fromFlow('/admin/flows/variables', 'f1')).toBe('/admin/flows/variables?flow=f1');
	});

	it('leaves the path alone without an id', () => {
		expect(fromFlow('/admin/flows/variables', '')).toBe('/admin/flows/variables');
	});
});

describe('flowBack', () => {
	it.each([
		['no parameter', 'http://x/admin/flows/datasources', { href: '/admin/flows', label: 'Flows' }],
		['a flow id', 'http://x/admin/flows/datasources?flow=f1', { href: '/admin/flows/f1', label: 'Flow editor' }],
		['a path', 'http://x/admin/flows/datasources?flow=..%2F..%2Fusers', { href: '/admin/flows', label: 'Flows' }],
		['an absolute url', 'http://x/admin/flows/datasources?flow=https%3A%2F%2Fevil', { href: '/admin/flows', label: 'Flows' }],
	])('returns the right link for %s', (_, url, want) => {
		expect(flowBack(new URL(url))).toEqual(want);
	});
});
