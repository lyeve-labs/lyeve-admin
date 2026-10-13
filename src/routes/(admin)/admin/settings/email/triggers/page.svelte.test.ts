// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailTrigger } from '$lib/api/email-triggers';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import TriggersPage from './+page.svelte';

afterEach(cleanup);

const trigger: EmailTrigger = {
	id: 'tr1',
	name: 'Order confirmation',
	event: 'after_create',
	schema: 'orders',
	template_key: 'order-confirmed',
	to_static: ['ops@example.test'],
	to_field: 'email',
	locale: '',
	enabled: true,
	updated_at: '2026-10-01T00:00:00Z',
};

const template = { id: 't1', key: 'order-confirmed', subject: 'Thanks', status: 'active' };

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			user: { roles: ['admin'] },
			triggers: { ok: true, value: { triggers: [trigger], events: ['after_create'] } },
			templates: { ok: true, value: [template] },
			schemas: { ok: true, value: ['orders'] },
			...over,
		} as never,
		form: form as never,
	};
}

describe('email triggers page', () => {
	it('says a failed template read failed rather than that the tenant has none', () => {
		render(TriggersPage, {
			props: props({ templates: { ok: false, gate: { state: 'error', message: 'The templates could not be read.' } } }),
		});
		expect(screen.getByText('The templates could not be read.')).toBeTruthy();
		expect(screen.queryByText('No active template')).toBeNull();
	});

	it('says the tenant has no active template when the read answered with none', () => {
		render(TriggersPage, { props: props({ templates: { ok: true, value: [{ ...template, status: 'draft' }] } }) });
		expect(screen.getByText('No active template')).toBeTruthy();
	});

	it('says a failed trigger read failed and offers no create', () => {
		const { container } = render(TriggersPage, {
			props: props({ triggers: { ok: false, gate: { state: 'unavailable' } } }),
		});
		expect(container.textContent).toContain('so Email triggers could not be read');
		expect(screen.queryByText('No triggers yet')).toBeNull();
		expect(screen.queryByRole('button', { name: 'New trigger' })).toBeNull();
	});

	it('keeps the first-run state with its create for a read that answered with none', () => {
		render(TriggersPage, { props: props({ triggers: { ok: true, value: { triggers: [], events: [] } } }) });
		expect(screen.getByText('No triggers yet')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: 'New trigger' })).toHaveLength(2);
	});
});

describe('email trigger drawer', () => {
	const drawerText = () => document.body.querySelector('form#trigger-form')?.textContent ?? '';

	it('shows a refused save inside the open drawer', async () => {
		const { rerender } = render(TriggersPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'New trigger' }));
		await rerender(props({}, { action: 'save', error: 'The trigger could not be saved.' }));
		expect(drawerText()).toContain('The trigger could not be saved.');
	});

	it('shows a failed delete above the list and leaves a newly opened drawer clean', async () => {
		const { container } = render(TriggersPage, { props: props({}, { action: 'delete', error: 'The trigger could not be deleted.' }) });
		expect(container.textContent).toContain('The trigger could not be deleted.');
		await fireEvent.click(screen.getByRole('button', { name: 'New trigger' }));
		expect(drawerText()).not.toContain('could not be deleted');
	});
});
