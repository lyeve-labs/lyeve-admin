// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import GateNotice from './GateNotice.svelte';
import type { Gate } from '$lib/api/gate';

afterEach(cleanup);

const ABSENT = 'The cache plugin is not part of this build, so nothing is cached.';

function mount(gate: Gate) {
	return render(GateNotice, { props: { gate, title: 'Cache', absent: ABSENT } });
}

describe('GateNotice', () => {
	it('says in the page\'s own words what a missing route means', () => {
		const { container } = mount({ state: 'absent' });
		expect(container.textContent).toContain(ABSENT);
	});

	it('draws a refused read as not enabled, with the link the refusal names', () => {
		const { getByTestId, getByRole } = mount({ state: 'locked', upgradeUrl: '/admin/settings/license?plugin=cache' });
		expect(getByTestId('not-enabled')).toBeTruthy();
		expect(getByRole('link', { name: 'How to enable it' }).getAttribute('href')).toBe('/admin/settings/license?plugin=cache');
	});

	it('states a ceiling with the numbers the refusal carried', () => {
		const { container } = mount({ state: 'full', limit: 7, current: 7, upgradeUrl: '' });
		expect(container.textContent).toContain('Cache is at its limit');
		expect(container.textContent).toContain('7 of 7 are in use');
	});

	it('reports a failed read as a failure', () => {
		const { container } = mount({ state: 'error', message: 'The cache could not be read.' });
		expect(container.textContent).toContain('The cache could not be read.');
	});

	it('draws nothing for a read that answered', () => {
		const { container } = mount({ state: 'ok' });
		expect(container.textContent?.trim()).toBe('');
	});
});
