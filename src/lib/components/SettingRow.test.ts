// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingRow from './SettingRow.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const base = { id: 'set-SMTP_HOST', name: 'SMTP_HOST', label: 'host', saved: 'Saved.' };

/*
 * Save is a statement that something changed, so it stays disabled until the draft differs from
 * what is stored, and comes back when the draft returns to it.
 */
describe('SettingRow', () => {
	it('keeps Save disabled until the value differs from the stored one', async () => {
		const { container } = render(SettingRow, { props: { ...base, value: 'mail.example' } });
		const input = container.querySelector<HTMLInputElement>('input[name="value"]')!;
		const save = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

		expect(input.value).toBe('mail.example');
		expect(save.disabled).toBe(true);
		await fireEvent.input(input, { target: { value: 'smtp.example' } });
		expect(save.disabled).toBe(false);
		await fireEvent.input(input, { target: { value: 'mail.example' } });
		expect(save.disabled).toBe(true);
	});

	it('treats anything typed into a secret as a change, since the stored value never returns', async () => {
		const { container } = render(SettingRow, {
			props: { ...base, name: 'SMTP_PASS', secret: true, value: null },
		});
		const input = container.querySelector<HTMLInputElement>('input[name="value"]')!;
		const save = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

		expect(input.value).toBe('');
		expect(save.disabled).toBe(true);
		await fireEvent.input(input, { target: { value: 'hunter2' } });
		expect(save.disabled).toBe(false);
		expect(container.querySelector('input[name="secret"]')?.getAttribute('value')).toBe('true');
	});

	it('posts the key it stands for and shows only its own outcome', () => {
		const own = render(SettingRow, {
			props: { ...base, value: 'x', result: { key: 'SMTP_HOST', success: true } },
		});
		expect(own.container.querySelector('input[name="key"]')?.getAttribute('value')).toBe('SMTP_HOST');
		expect(own.container.textContent).toContain('Saved.');

		const other = render(SettingRow, {
			props: { ...base, value: 'x', result: { key: 'SMTP_PORT', error: 'refused' } },
		});
		expect(other.container.textContent).not.toContain('refused');
	});
});
