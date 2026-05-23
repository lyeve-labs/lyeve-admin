// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import TransformUrlBuilder from './TransformUrlBuilder.svelte';
import FocalPointPicker from './FocalPointPicker.svelte';

afterEach(cleanup);

describe('TransformUrlBuilder', () => {
	it('shows the signed URL the engine answered and when it stops working', () => {
		const { container } = render(TransformUrlBuilder, {
			props: {
				id: 'm1',
				published: false,
				focal: null,
				signed: { url: '/api/v1/media/m1/transform?w=800&sig=abc', expires_at: '2026-10-03T10:00:00Z' },
			},
		});
		expect((container.querySelector('#transform-result') as HTMLInputElement | null)?.value ?? container.textContent).toContain(
			'/api/v1/media/m1/transform?w=800&sig=abc',
		);
		expect(container.textContent).toContain('Stops working');
	});

	it('renders the refusal in place of a URL', () => {
		const { getByTestId } = render(TransformUrlBuilder, {
			props: { id: 'm1', published: true, focal: null, refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } },
		});
		expect(getByTestId('refusal-notice').textContent).toContain('example-feature');
	});

	it('renders a cap refusal with its numbers', () => {
		const { getByTestId } = render(TransformUrlBuilder, {
			props: { id: 'm1', published: true, focal: null, refused: { kind: 'cap', cap: 'example.items', limit: 9, current: 9, upgradeUrl: '' } },
		});
		const text = getByTestId('refusal-notice').textContent ?? '';
		expect(text).toContain('9 of 9 items are in use');
	});

	it('sends the focal point only when the file has one', () => {
		const { container } = render(TransformUrlBuilder, { props: { id: 'm1', published: true, focal: { x: 0.2, y: 0.8 } } });
		expect(container.querySelector('input[name="focal_x"]')?.getAttribute('value')).toBe('0.2');
		expect(container.querySelector('input[name="use_focal"]')?.getAttribute('value')).toBe('true');
	});
});

describe('FocalPointPicker', () => {
	it('starts from the stored point and offers to reset it', () => {
		const { container, getByText } = render(FocalPointPicker, {
			props: { id: 'm1', src: '/f', alt: 'a', stored: { x: 0.25, y: 0.75 } },
		});
		expect(container.querySelector('input[name="x"]')?.getAttribute('value')).toBe('0.25');
		expect(getByText('Reset to center')).toBeTruthy();
	});

	it('moves the point with the arrow keys', async () => {
		const { container, getByRole } = render(FocalPointPicker, { props: { id: 'm1', src: '/f', alt: 'a', stored: null } });
		const target = getByRole('button', { name: /Focal point at 50% across/ });
		target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector('input[name="x"]')?.getAttribute('value')).toBe('0.55');
	});
});
