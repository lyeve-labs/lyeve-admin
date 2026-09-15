// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureLocalProvider, fixtureProvider, fixtureSettings } from '$lib/components/ai/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: {
				gate: { state: 'ok' },
				provider: fixtureProvider,
				aiSettings: fixtureSettings,
				aiLayoutGate: { state: 'ok' },
				isSuperAdmin: true,
				...overrides,
			},
			form,
		} as never,
	});
}

describe('AI provider detail page', () => {
	it('shows a stored key as a placeholder and keeps it on a blank save', () => {
		const { container } = setup();
		const key = container.querySelector('input[name="api_key"]') as HTMLInputElement;
		expect(key.placeholder).toBe('Stored');
		expect(key.required).toBe(false);
		expect(container.textContent).toContain('Leave this blank to keep it.');
	});

	it('shows the compatible fields and the private-address warning for a super admin', () => {
		const { container, getByText } = setup({ provider: fixtureLocalProvider });
		expect((container.querySelector('input[name="base_url"]') as HTMLInputElement).value).toBe('http://localhost:11434/v1');
		expect(container.querySelector('input[name="key_header"]')).toBeTruthy();
		expect(container.querySelector('input[name="query_string"]')).toBeTruthy();
		expect(getByText(/skip the private-address check/)).toBeTruthy();
		expect(getByText(/Enter it again/)).toBeTruthy();
	});

	it('hides the configuration form from a tenant admin and keeps the reads', () => {
		const { container, getByText, queryByText } = setup({ isSuperAdmin: false });
		expect(container.querySelector('form[action="?/update"]')).toBeNull();
		expect(queryByText('Configuration')).toBeNull();
		expect(getByText('List models')).toBeTruthy();
		expect(getByText('Check')).toBeTruthy();
	});

	it('lists the models and the capabilities the actions answered', () => {
		const models = setup({}, { scope: 'models', models: ['gpt-4o', 'o3-mini'] });
		expect(models.getByRole('list', { name: 'Models' }).textContent).toContain('o3-mini');
		cleanup();
		const caps = setup({}, { scope: 'capabilities', capabilities: { model: 'gpt-4o', kind: 'openai', max_tokens: 128000, text: true, embed: false, image: true, vision: true } });
		expect(caps.getByTestId('capabilities').textContent).toContain('128000 tokens');
	});

	it('paints the off state with the switch instead of the row', () => {
		const { getByText, container } = setup({ gate: { state: 'off' }, provider: null });
		expect(getByText('AI is switched off for this tenant')).toBeTruthy();
		expect(container.querySelector('form[action="?/update"]')).toBeNull();
	});
});
