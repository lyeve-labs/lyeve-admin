// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import AddToRelease from './AddToRelease.svelte';

afterEach(cleanup);

const releases = [{ id: 'r1', name: 'Launch', status: 'draft' as const }];

describe('AddToRelease', () => {
	it('offers the two ways out as a segmented control that submits its choice', () => {
		const { container } = render(AddToRelease, { props: { releases, holding: [] } });
		expect(screen.getByRole('radiogroup', { name: 'When it goes out' })).toBeTruthy();
		expect(container.querySelector('input[type="hidden"][name="action"]')?.getAttribute('value')).toBe('publish');
	});

	it('says the releases could not be read instead of claiming none is open', () => {
		render(AddToRelease, { props: { releases: [], holding: [], failed: true } });
		expect(screen.getByText(/The releases could not be read/)).toBeTruthy();
		expect(screen.queryByText(/No release is open/)).toBeNull();
	});
});
