// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InlineUpgradeLink from './InlineUpgradeLink.svelte';

afterEach(cleanup);

describe('InlineUpgradeLink', () => {
	it('names a plan link by what it opens, in a tab of its own that cannot reach back', () => {
		render(InlineUpgradeLink, { props: { link: { href: 'https://shop.example.com/pricing?plan=basic', label: 'License' } } });
		const a = screen.getByRole('link', { name: 'View the plan' });
		expect(a.getAttribute('target')).toBe('_blank');
		expect(a.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('keeps the label the link was served with when the address says nothing', () => {
		render(InlineUpgradeLink, { props: { link: { href: '/admin/settings/license', label: 'Open the license' } } });
		const a = screen.getByRole('link', { name: 'Open the license' });
		expect(a.getAttribute('target')).toBeNull();
		expect(a.getAttribute('rel')).toBeNull();
	});

	it('says how to raise the limit for a refusal at a ceiling', () => {
		render(InlineUpgradeLink, { props: { link: { href: '/admin/settings/license' }, raises: true } });
		expect(screen.getByRole('link', { name: 'How to raise the limit' })).toBeTruthy();
	});

	it('says how to enable it otherwise', () => {
		render(InlineUpgradeLink, { props: { link: { href: '/admin/settings/license' } } });
		expect(screen.getByRole('link', { name: 'How to enable it' })).toBeTruthy();
	});

	// A link on its own line is a target for a finger. One inside a sentence
	// sits in the sentence's line box.
	it('gives a link on its own line a touch target and leaves one in a sentence inline', () => {
		render(InlineUpgradeLink, { props: { link: { href: '/a' }, standalone: true } });
		render(InlineUpgradeLink, { props: { link: { href: '/b' } } });
		const [own, inSentence] = screen.getAllByRole('link');
		expect(own.className).toContain('hit-area');
		expect(inSentence.className).not.toContain('hit-area');
		expect(inSentence.className).toContain('ml-1');
	});
});
