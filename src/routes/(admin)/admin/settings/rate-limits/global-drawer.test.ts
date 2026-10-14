// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RateRule } from '$lib/api/rate-limit';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import GlobalDrawer from './GlobalDrawer.svelte';

afterEach(cleanup);

const form = () => document.body.querySelector('form#rate-global-form') as HTMLFormElement | null;
const field = (name: string) => (form() ? new FormData(form()!).get(name) : null);

describe('the global limit drawer', () => {
	it('stays shut until the page opens it', () => {
		render(GlobalDrawer, { props: { error: '' } });
		expect(form()).toBeNull();
	});

	it('opens on the stored limit and posts it to the global action', () => {
		const { component } = render(GlobalDrawer, { props: { error: '' } });
		component.openGlobal({ rate: 7, burst: 70, enabled: true } as RateRule);
		flushSync();
		expect(form()?.getAttribute('action')).toBe('?/global');
		expect(field('rate')).toBe('7');
		expect(field('burst')).toBe('70');
		expect(field('enabled')).toBe('true');
	});

	it('opens on the shipped values when no limit was read', () => {
		const { component } = render(GlobalDrawer, { props: { error: '' } });
		component.openGlobal(null);
		flushSync();
		expect(field('rate')).toBe('50');
		expect(field('burst')).toBe('100');
		expect(field('enabled')).toBe('false');
	});

	it('shows its failure first in its form', () => {
		const { component } = render(GlobalDrawer, { props: { error: 'The global limit could not be saved.' } });
		component.openGlobal(null);
		flushSync();
		expect(form()?.firstElementChild?.firstElementChild?.textContent).toContain('The global limit could not be saved.');
	});
});
