// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);

import PageTitle from './PageTitle.svelte';

afterEach(() => {
	cleanup();
	state.page.data = {};
});

describe('PageTitle', () => {
	it('ends in the product name while the tenant has not named the admin', async () => {
		render(PageTitle, { props: { title: 'Plugins' } });
		await tick();
		expect(document.title).toBe('Plugins - LyEve Admin');
	});

	it('ends in the tenant name once it has one', async () => {
		state.page.data = { brand: { name: 'Acme Studio', logo_url: '', accent: '', favicon_url: '' } };
		render(PageTitle, { props: { title: 'Plugins' } });
		await tick();
		expect(document.title).toBe('Plugins - Acme Studio');
	});
});
