// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import BrandImageCard from './BrandImageCard.svelte';

afterEach(cleanup);

describe('the brand image card', () => {
	it('says the media library could not be read rather than that it is empty', () => {
		const { container } = render(BrandImageCard, { props: { kind: 'logo', current: '', mediaChoices: null } });
		expect(container.textContent).toContain('The media library could not be read, so nothing can be chosen from it.');
	});

	it('offers the library when it was read', () => {
		const { container } = render(BrandImageCard, { props: { kind: 'logo', current: '', mediaChoices: [] } });
		expect(container.textContent).not.toContain('could not be read');
	});
});
