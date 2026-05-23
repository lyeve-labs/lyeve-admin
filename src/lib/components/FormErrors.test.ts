// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import FormErrors from './FormErrors.svelte';

afterEach(cleanup);

const region = (container: HTMLElement) => container.querySelector('[aria-live]');

/*
 * The browser's own validation bubble is unstyled, shows one field at a time,
 * is gone on the next click and is never announced. An element carrying
 * role="alert" that is not in the tree before the failure is announced
 * inconsistently, so the live region is always mounted.
 */
describe('FormErrors', () => {
	it('mounts the live region before there is anything to announce', () => {
		const { container } = render(FormErrors, { props: {} });

		expect(region(container)).toBeTruthy();
		expect(region(container)?.textContent?.trim()).toBe('');
	});

	it('announces assertively, because the message is about what was just done', () => {
		const { container } = render(FormErrors, { props: { message: 'Nope' } });

		expect(region(container)?.getAttribute('aria-live')).toBe('assertive');
		expect(region(container)?.getAttribute('aria-atomic')).toBe('true');
	});

	it('shows the action message', () => {
		const { container } = render(FormErrors, { props: { message: 'Failed to create user' } });

		expect(container.textContent).toContain('Failed to create user');
	});

	// The field messages are already beside their controls, so repeating them
	// here would say everything twice. The count is what a reader at the top of
	// a form cannot otherwise tell.
	it('counts the rejected fields rather than repeating them', () => {
		const { container } = render(FormErrors, {
			props: {
				message: 'Check the highlighted fields.',
				fields: { email: 'Email is required', password: 'Password is required' },
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('2 fields need attention.');
		expect(text).not.toContain('Email is required');
	});

	it('agrees in number with one rejected field', () => {
		const { container } = render(FormErrors, {
			props: { fields: { email: 'Email is required' } },
		});

		expect(container.textContent).toContain('1 field needs attention.');
	});

	it('stays empty when the action succeeded', () => {
		const { container } = render(FormErrors, { props: { fields: {} } });

		expect(container.querySelector('[role="alert"]')).toBeNull();
	});
});
