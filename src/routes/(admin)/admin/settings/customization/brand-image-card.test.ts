// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import BrandImageCard from './BrandImageCard.svelte';

afterEach(cleanup);

describe('the brand image card', () => {
	it('hands the picker a library that could not be read, which says so rather than that it is empty', async () => {
		render(BrandImageCard, { props: { kind: 'logo', current: '', mediaChoices: null } });
		await fireEvent.click(screen.getByRole('button', { name: /choose from the library/i }));
		expect(document.body.textContent).toContain('The library could not be read');
		expect(document.body.textContent).not.toContain('No published files');
	});

	it('says an empty library is empty', async () => {
		render(BrandImageCard, { props: { kind: 'logo', current: '', mediaChoices: [] } });
		await fireEvent.click(screen.getByRole('button', { name: /choose from the library/i }));
		expect(document.body.textContent).toContain('No published files');
	});
});
