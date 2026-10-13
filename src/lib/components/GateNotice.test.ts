// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GateNotice from './GateNotice.svelte';
import type { Gate } from '$lib/api/gate';
import { BUSY } from '$lib/outage';

const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin/cache?tab=rules&offset=50#top') } }));
vi.mock('$app/state', () => state);

afterEach(cleanup);
beforeEach(() => {
	state.page.url = new URL('http://localhost/admin/cache?tab=rules&offset=50#top');
});

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

describe('GateNotice for a role the engine refused', () => {
	it('names the feature the role cannot open and who to ask', () => {
		const { container } = mount({ state: 'forbidden' });
		expect(container.textContent?.trim()).toBe('Your role cannot open Cache. Ask a super admin if you need it.');
	});

	it('is not drawn as a failure', () => {
		const { container } = mount({ state: 'forbidden' });
		expect(container.textContent).not.toContain('could not be read');
		expect(container.querySelector('.text-danger')).toBeNull();
	});

	it('offers nothing to press, because trying again cannot change a role', () => {
		const { container } = mount({ state: 'forbidden' });
		expect(container.querySelector('a, button')).toBeNull();
	});
});

describe('GateNotice for a read nothing answered', () => {
	it('says it is temporary, names what could not be read and that nothing changed', () => {
		const { container } = mount({ state: 'unavailable' });
		expect(container.textContent).toContain('Temporarily unavailable');
		expect(container.textContent).toContain(
			'The engine or its database did not answer, so Cache could not be read. Nothing was changed. Try again in a moment.',
		);
	});

	it('is not drawn as a failure', () => {
		const { container } = mount({ state: 'unavailable' });
		expect(container.querySelector('.text-danger')).toBeNull();
	});
});

describe('GateNotice for a read the engine refused for the rate', () => {
	it('says so in the words every surface uses for it', () => {
		const { container } = mount({ state: 'busy' });
		expect(container.textContent).toContain(BUSY.title);
		expect(container.textContent).toContain(BUSY.body);
	});

	it('is not drawn as an outage or a failure', () => {
		const { container } = mount({ state: 'busy' });
		expect(container.textContent).not.toContain('did not answer');
		expect(container.querySelector('.text-danger')).toBeNull();
	});
});

describe('Try again', () => {
	function retry(gate: Gate): HTMLAnchorElement | null {
		const { queryByRole } = mount(gate);
		return queryByRole('link', { name: 'Try again' }) as HTMLAnchorElement | null;
	}

	it('is a link to the current path and query, so it works before the page hydrates', () => {
		for (const gate of [{ state: 'unavailable' }, { state: 'busy' }, { state: 'error', message: 'The cache could not be read.' }] as Gate[]) {
			const link = retry(gate);
			expect(link?.getAttribute('href')).toBe('/admin/cache?tab=rules&offset=50');
			cleanup();
		}
	});

	it('asks for a fresh document, because the router keeps the data of an unchanged address', () => {
		// The two values the router reads as on.
		expect(['', 'true']).toContain(retry({ state: 'unavailable' })?.getAttribute('data-sveltekit-reload'));
	});

	it('follows the address the reader is on', () => {
		state.page.url = new URL('http://localhost/admin/jobs');
		expect(retry({ state: 'unavailable' })?.getAttribute('href')).toBe('/admin/jobs');
	});

	it('is offered only where waiting can help', () => {
		for (const gate of [
			{ state: 'absent' },
			{ state: 'locked', upgradeUrl: '' },
			{ state: 'full', limit: 1, current: 1, upgradeUrl: '' },
			{ state: 'forbidden' },
			{ state: 'ok' },
		] as Gate[]) {
			expect(retry(gate), gate.state).toBeNull();
			cleanup();
		}
	});
});
