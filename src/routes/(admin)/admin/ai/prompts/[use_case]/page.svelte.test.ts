// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureDefaultPrompt, fixturePrompt, fixtureSettings } from '$lib/components/ai/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: { gate: { state: 'ok' }, prompt: fixturePrompt, aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: false, ...overrides },
			form,
		} as never,
	});
}

describe('AI prompt page', () => {
	it('seeds the editor with the text in force and names the next version', () => {
		const { container, getByText } = setup();
		expect((container.querySelector('textarea[name="body"]') as HTMLTextAreaElement).value).toBe('Summarize in three bullets.');
		expect(getByText('Save as version 3')).toBeTruthy();
		expect(getByText('Version 2 in force')).toBeTruthy();
	});

	it('lists the versions with the shipped default as v0 and a restore on every one but the current', () => {
		const { container, getByLabelText, queryByLabelText } = setup();
		const rows = container.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(3);
		expect(rows[0].textContent).toContain('v2');
		expect(rows[0].textContent).toContain('current');
		expect(rows[2].textContent).toContain('v0');
		expect(rows[2].textContent).toContain('shipped');
		expect(queryByLabelText('Make version 2 current')).toBeNull();
		expect(getByLabelText('Make version 1 current')).toBeTruthy();
		expect(getByLabelText('Make the shipped default current')).toBeTruthy();
		expect(container.textContent).toContain(fixturePrompt.guardrail);
	});

	it('marks the shipped default current when nothing was saved', () => {
		const { getByText, queryByLabelText, container } = setup({ prompt: fixtureDefaultPrompt });
		expect(getByText('Shipped default in force')).toBeTruthy();
		expect(getByText('Save as version 1')).toBeTruthy();
		expect(queryByLabelText('Make the shipped default current')).toBeNull();
		expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
	});

	it('reports a save and a restore', () => {
		const saved = setup({}, { scope: 'save', version: 3 });
		expect(saved.getByRole('status').textContent).toContain('Saved as version 3.');
		cleanup();
		const restored = setup({}, { scope: 'restore', version: 3, from: 1 });
		expect(restored.getByRole('status').textContent).toContain('Version 1 is current again, saved as version 3.');
	});

	it('paints the locked state and no editor', () => {
		const { container, getByText } = setup({ gate: { state: 'locked' }, prompt: null });
		expect(getByText('Not enabled on this instance.')).toBeTruthy();
		expect(container.querySelector('textarea')).toBeNull();
	});
});
