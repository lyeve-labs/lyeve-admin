// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MediaPicker from './MediaPicker.svelte';

afterEach(cleanup);

const choice = {
	id: 'm1',
	filename: 'kettle.jpg',
	alt_text: 'A kettle',
	content_type: 'image/jpeg',
	public_url: '/api/v1/media/m1/kettle.jpg',
};

describe('MediaPicker', () => {
	it('hands back the chosen file', async () => {
		const onpick = vi.fn();
		const { getByRole, findByRole } = render(MediaPicker, { props: { choices: [choice], onpick } });
		await fireEvent.click(getByRole('button', { name: 'Choose from library' }));
		await fireEvent.click(await findByRole('button', { name: 'Choose kettle.jpg' }));
		expect(onpick).toHaveBeenCalledWith(choice);
	});

	it('says where to publish a file when none is published', async () => {
		const { getByRole, findByText } = render(MediaPicker, { props: { choices: [], onpick: vi.fn() } });
		await fireEvent.click(getByRole('button', { name: 'Choose from library' }));
		expect(await findByText('No published files')).toBeTruthy();
	});
});
