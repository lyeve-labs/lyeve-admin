// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TemplatesPage from './+page.svelte';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const reset = { id: 't1', key: 'password-reset', subject: 'Reset your password', mjml_source: '<mjml>{{.Vars.reset_link}}</mjml>', status: 'active', required: true };
const sale = { id: 't2', key: 'spring-sale', subject: 'Sale', mjml_source: '<mjml/>', status: 'draft', required: false };
const starters = [
	{ key: 'password-reset', subject: 'Reset', mjml_source: '<mjml/>', required: true, link_variable: 'reset_link' },
	{ key: 'welcome', subject: 'Welcome aboard', mjml_source: '<mjml>welcome body</mjml>', required: false },
];

function data(overrides: Record<string, unknown> = {}): PageData {
	return { templates: [reset, sale], starters, limits: { limit: 5, current: 2 }, loadError: null, ...overrides } as unknown as PageData;
}

describe('email templates page', () => {
	it('marks the required templates and offers no delete for them', () => {
		render(TemplatesPage, { props: { data: data(), form: null } });
		expect(screen.getByText('Required')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Delete password-reset' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Delete spring-sale' })).toBeTruthy();
		expect(screen.getByTestId('template-usage').textContent).toContain('2 of 5 templates');
	});

	it('says every slot is taken and holds the create back at the ceiling', () => {
		render(TemplatesPage, { props: { data: data({ limits: { limit: 5, current: 5 } }), form: null } });
		expect(screen.getByText('Every template slot is in use')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'New template' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('states no ceiling when the license lifts it', () => {
		render(TemplatesPage, { props: { data: data({ limits: { limit: 0, current: 9 } }), form: null } });
		expect(screen.getByTestId('template-usage').textContent).toContain('9 templates, no limit');
		expect((screen.getByRole('button', { name: 'New template' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('tells the author which link a required template has to keep', async () => {
		render(TemplatesPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit password-reset' }));
		expect(screen.getByText('Required template')).toBeTruthy();
		expect(screen.getByText('{{.Vars.reset_link}}')).toBeTruthy();
	});

	it('shows the ceiling refusal with its numbers', () => {
		render(TemplatesPage, {
			props: { data: data(), form: { error: 'x', refused: { kind: 'cap', cap: 'email.templates', limit: 5, current: 5, upgradeUrl: '' } } as never },
		});
		expect(screen.getByTestId('refusal-notice').textContent).toContain('5 of 5 templates');
	});
});
