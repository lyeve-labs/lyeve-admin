// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailTrigger } from '$lib/api/email-triggers';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

/**
 * Press a row's delete, accept the question, and return its title and what
 * the hidden form held when it was sent. The value has to be in the form by
 * then, which is what waiting on the next render before sending is for.
 */
async function pressDelete(button: HTMLElement, field: string): Promise<{ title: string; sent: string }> {
	let sent = '';
	const spy = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(function (this: HTMLFormElement) {
		sent = (this.querySelector(`input[name="${field}"]`) as HTMLInputElement | null)?.value ?? '';
	});
	kit.confirm.mockClear();
	await fireEvent.click(button);
	await vi.waitFor(() => expect(spy).toHaveBeenCalled());
	spy.mockRestore();
	return { title: String((kit.confirm.mock.calls[0] as unknown[] | undefined)?.[0] ?? ''), sent };
}


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

	it('says the tenant has no active template when the read answered with none, and offers no create', () => {
		render(TriggersPage, {
			props: props({
				triggers: { ok: true, value: { triggers: [], events: [] } },
				templates: { ok: true, value: [{ ...template, status: 'draft' }] },
			}),
		});
		expect(screen.getByText('No active template')).toBeTruthy();
		expect(screen.getByText('No triggers yet')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'New trigger' })).toBeNull();
	});

	it('offers no create while the templates could not be read', () => {
		render(TriggersPage, {
			props: props({ templates: { ok: false, gate: { state: 'error', message: 'The templates could not be read.' } } }),
		});
		expect(screen.queryByRole('button', { name: 'New trigger' })).toBeNull();
	});

	it('shows the stored schema and template when editing after their reads failed', async () => {
		render(TriggersPage, {
			props: props({
				templates: { ok: false, gate: { state: 'unavailable' } },
				schemas: { ok: false, gate: { state: 'unavailable' } },
			}),
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Order confirmation' }));
		const form = document.body.querySelector('form#trigger-form') as HTMLFormElement;
		expect((form.querySelector('input[name="schema"]') as HTMLInputElement).value).toBe('orders');
		expect((form.querySelector('input[name="template_key"]') as HTMLInputElement).value).toBe('order-confirmed');
		expect(form.querySelector('#trigger-schema')?.textContent).toContain('orders');
		expect(form.querySelector('#trigger-template')?.textContent).toContain('order-confirmed');
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

	it('shows the license a refused save needs inside the open drawer', async () => {
		const { rerender } = render(TriggersPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'New trigger' }));
		const refused = { kind: 'feature', feature: 'Email Pro', plugin: 'email', upgradeUrl: '' };
		await rerender(props({}, { action: 'save', error: 'This needs Email Pro.', refused }));
		expect(drawerText()).toContain('Email Pro');
		expect(drawerText()).not.toContain('This needs Email Pro.');
	});

	it('shows a failed delete above the list and leaves a newly opened drawer clean', async () => {
		const { container } = render(TriggersPage, { props: props({}, { action: 'delete', error: 'The trigger could not be deleted.' }) });
		expect(container.textContent).toContain('The trigger could not be deleted.');
		await fireEvent.click(screen.getByRole('button', { name: 'New trigger' }));
		expect(drawerText()).not.toContain('could not be deleted');
	});
});

describe('email trigger delete', () => {
	it('names the trigger and sends its id', async () => {
		render(TriggersPage, { props: props() });
		const out = await pressDelete(screen.getByRole('button', { name: 'Delete Order confirmation' }), 'id');
		expect(out.title).toBe('Delete trigger Order confirmation');
		expect(out.sent).toBe('tr1');
	});
});

describe('email trigger pickers', () => {
	it('lets the schema and the template be searched', async () => {
		render(TriggersPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'New trigger' }));
		await fireEvent.click(document.body.querySelector('#trigger-schema') as HTMLElement);
		expect(screen.getByRole('combobox', { name: 'Search In' })).toBeTruthy();
	});
});
