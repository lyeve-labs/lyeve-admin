import { describe, expect, it } from 'vitest';
import { Database, Plug, Puzzle } from '@lucide/svelte';
import { categoryIcon, categoryLabel, categoryStripe, categoryText, pluginLabel } from './categories';

describe('categories', () => {
	it('keeps the built-in paint and gives every contributed category the neutral one', () => {
		expect(categoryIcon('data')).toBe(Database);
		expect(categoryText('data')).toBe('text-violet');
		expect(categoryIcon('integration')).toBe(Plug);
		expect(categoryText('integration')).toBe('text-brand-deep');
		expect(categoryIcon('device-fingerprint')).toBe(Puzzle);
		expect(categoryText('device-fingerprint')).toBe('text-muted');
		expect(categoryStripe('device-fingerprint')).toBe('bg-muted');
		expect(categoryIcon(undefined)).toBe(Puzzle);
	});

	it('titles a contributed section with the plugin name in sentence case', () => {
		expect(pluginLabel('device-fingerprint')).toBe('Device fingerprint');
		expect(pluginLabel('ab_testing')).toBe('Ab testing');
		expect(pluginLabel('flow')).toBe('Flow');
		expect(categoryLabel('data')).toBe('Data');
		expect(categoryLabel('integration')).toBe('Integration');
		expect(categoryLabel('device-fingerprint')).toBe('Device fingerprint');
	});
});
