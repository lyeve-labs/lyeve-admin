// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import SignInPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const props = (window: { days: number } | null, gate: unknown = { state: 'ok' }, form: unknown = null) => ({
	data: { gate, window } as never,
	form: form as never,
});

describe('sign-in window', () => {
	it('starts the field from the stored window', () => {
		render(SignInPage, { props: props({ days: 12 }) });
		expect((screen.getByLabelText(/Days since the last provider sign-in/) as HTMLInputElement).value).toBe('12');
	});

	it('says what 0 and the default mean', () => {
		const { container } = render(SignInPage, { props: props({ days: 30 }) });
		expect(said(container)).toContain('0 allows sign-in through the provider only.');
		expect(said(container)).toContain('The default is 30 days, and the most is 365.');
	});

	it('bounds the field to whole days from 0 to 365, so the browser refuses the rest', () => {
		render(SignInPage, { props: props({ days: 30 }) });
		const field = screen.getByLabelText(/Days since the last provider sign-in/) as HTMLInputElement;
		expect(field.name).toBe('days');
		expect(field.min).toBe('0');
		expect(field.max).toBe('365');
		expect(field.step).toBe('1');
		expect(field.required).toBe(true);
	});

	it('states a refused save', () => {
		const { container } = render(SignInPage, {
			props: props({ days: 30 }, { state: 'ok' }, { error: 'Enter a whole number of days from 0 to 365.', days: '400' }),
		});
		expect(said(container)).toContain('Enter a whole number of days from 0 to 365.');
	});

	it('shows no form when the read failed', () => {
		const { container } = render(SignInPage, {
			props: props(null, { state: 'error', message: 'The sign-in window could not be read. This is not a report that none is set.' }),
		});
		expect(container.querySelector('input[name="days"]')).toBeNull();
		expect(said(container)).toContain('could not be read');
	});
});
