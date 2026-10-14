// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import UpgradeLink from './UpgradeLink.svelte';

afterEach(cleanup);

describe('UpgradeLink', () => {
	it('opens another origin in a tab of its own that cannot reach back', () => {
		render(UpgradeLink, { props: { link: { href: 'https://example.com/pricing', label: 'See plans' } } });
		const a = screen.getByRole('link', { name: 'See plans' });
		expect(a.getAttribute('target')).toBe('_blank');
		expect(a.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('stays in this tab for a page of the admin and names the step when nothing else does', () => {
		render(UpgradeLink, { props: { link: { href: '/admin/settings/license' } } });
		const a = screen.getByRole('link', { name: 'How to enable it' });
		expect(a.getAttribute('target')).toBeNull();
		expect(a.getAttribute('rel')).toBeNull();
	});
});
