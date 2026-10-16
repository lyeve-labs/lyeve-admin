// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import FocalPointPicker from './FocalPointPicker.svelte';

afterEach(cleanup);

function setup(props: Record<string, unknown> = {}) {
	const result = render(FocalPointPicker, {
		props: { id: 'm1', src: '/files/photo.jpg', alt: 'A photo', stored: null, ...props } as never,
	});
	const picker = result.getByRole('button', { name: /^Focal point at/ });
	const saveButton = result.getByRole('button', { name: 'Save focal point' }) as HTMLButtonElement;
	const saveForm = saveButton.closest('form') as HTMLFormElement;
	return { ...result, picker, saveButton, saveForm };
}

describe('FocalPointPicker', () => {
	it('starts at the center when the file stores no point, with nothing to save', () => {
		const { picker, saveButton, saveForm, queryByRole } = setup();
		expect(picker.getAttribute('aria-label')).toContain('50% across and 50% down');
		const sent = new FormData(saveForm);
		expect([sent.get('id'), sent.get('x'), sent.get('y')]).toEqual(['m1', '0.5', '0.5']);
		expect(saveButton.disabled).toBe(false);
		expect(queryByRole('button', { name: 'Reset to center' })).toBeNull();
	});

	it('places the point where the image was clicked, measured against the image', async () => {
		const { picker, saveForm, container } = setup();
		const img = container.querySelector('img') as HTMLImageElement;
		img.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 400, right: 300, bottom: 450, x: 100, y: 50, toJSON: () => ({}) });
		await fireEvent.click(picker, { clientX: 150, clientY: 350 });
		const sent = new FormData(saveForm);
		expect([sent.get('x'), sent.get('y')]).toEqual(['0.25', '0.75']);
		expect(picker.getAttribute('aria-label')).toContain('25% across and 75% down');
	});

	it('nudges the point with the arrow keys and stops at the edge', async () => {
		const { picker, saveForm } = setup({ stored: { x: 0.98, y: 0.5 } });
		await fireEvent.keyDown(picker, { key: 'ArrowRight' });
		await fireEvent.keyDown(picker, { key: 'ArrowUp' });
		const sent = new FormData(saveForm);
		expect([sent.get('x'), sent.get('y')]).toEqual(['1', '0.45']);
	});

	it('has nothing to save until the stored point moves', async () => {
		const { picker, saveButton } = setup({ stored: { x: 0.3, y: 0.6 } });
		expect(saveButton.disabled).toBe(true);
		await fireEvent.keyDown(picker, { key: 'ArrowDown' });
		expect(saveButton.disabled).toBe(false);
	});

	it('offers a reset that clears the stored point', () => {
		const { getByRole } = setup({ stored: { x: 0.3, y: 0.6 } });
		const reset = getByRole('button', { name: 'Reset to center' }).closest('form') as HTMLFormElement;
		expect(reset.getAttribute('action')).toBe('?/focal');
		const sent = new FormData(reset);
		expect([sent.get('id'), sent.get('clear')]).toEqual(['m1', 'true']);
	});

	it('shows a failed save and not the confirmation', () => {
		const { getByText, queryByText } = setup({ error: 'The point could not be saved.', saved: true });
		expect(getByText('The point could not be saved.')).toBeTruthy();
		expect(queryByText(/Focal point saved/)).toBeNull();
	});

	it('confirms a save', () => {
		const { getByText } = setup({ saved: true });
		expect(getByText(/Focal point saved/)).toBeTruthy();
	});
});
