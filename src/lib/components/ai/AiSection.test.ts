// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AiSection from './AiSection.svelte';
import Body from './ai-section-body.test.svelte';
import type { AiGate } from '$lib/api/ai';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...args: unknown[]) => goto(...args) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const ok: AiGate = { state: 'ok' };

// A component stands in for a snippet: both are called the same way by
// {@render}, and a test cannot declare a snippet outside a .svelte file.
function setup(gate: AiGate, layoutGate: AiGate = ok, tab = 'providers') {
	return render(AiSection, { props: { tab, gate, layoutGate, noun: 'providers', children: Body } as never });
}

describe('AiSection', () => {
	it('renders the five tabs and navigates on a tab', async () => {
		const { getAllByRole, getByTestId } = setup(ok);
		expect(getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Providers', 'Prompts', 'Transcripts', 'Prices', 'Settings']);
		expect(getByTestId('body')).toBeTruthy();
		await fireEvent.click(getAllByRole('tab')[2]);
		expect(goto).toHaveBeenCalledWith('/admin/ai/transcripts');
	});

	it('shows the not-enabled state when locked', () => {
		const { queryByTestId, getByText } = setup({ state: 'locked' });
		expect(queryByTestId('body')).toBeNull();
		expect(queryByTestId('not-enabled')).toBeTruthy();
		expect(getByText('Not enabled on this instance.')).toBeTruthy();
	});

	it('names the role and the resource when forbidden', () => {
		const { getByText, queryByTestId } = setup({ state: 'forbidden' });
		expect(getByText('Your role cannot read AI providers.')).toBeTruthy();
		expect(queryByTestId('body')).toBeNull();
	});

	it('shows the switch as the way back when the tenant is off', () => {
		const { getByText, getByTestId, queryByTestId } = setup({ state: 'off' });
		expect(getByText('AI is switched off for this tenant')).toBeTruthy();
		const form = getByTestId('ai-off-switch') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('/admin/ai/settings?/save');
		expect((form.querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe('true');
		expect(getByText('Turn AI on')).toBeTruthy();
		expect(queryByTestId('body')).toBeNull();
	});

	it('keeps the settings tab reachable while off', () => {
		const { getByTestId, queryByText } = setup({ state: 'off' }, ok, 'settings');
		expect(getByTestId('body')).toBeTruthy();
		expect(queryByText('AI is switched off for this tenant')).toBeNull();
	});

	it('points at providers when nothing can answer', () => {
		const { getByText, getByRole } = setup({ state: 'no_provider' });
		expect(getByText('AI has nothing to answer through')).toBeTruthy();
		expect(getByRole('link', { name: 'Open providers' }).getAttribute('href')).toBe('/admin/ai/providers');
	});

	it('shows the banner on an engine error without the engine text', () => {
		const { getByText } = setup({ state: 'error', message: 'Providers could not be read from the engine. This is not a report that there are none.' });
		expect(getByText(/could not be read from the engine/)).toBeTruthy();
	});

	it('lets the layout say the plugin is absent over a page that read nothing', () => {
		const { getByText, queryByTestId } = setup({ state: 'off' }, { state: 'absent' });
		expect(getByText('The AI plugin is not installed')).toBeTruthy();
		expect(queryByTestId('body')).toBeNull();
	});
});
