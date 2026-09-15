// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureSettings } from '$lib/components/ai/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const instance = [
	{ key: 'ai_transcript_retention', value: '720h', source: 'default', editable: true },
	{ key: 'ai_transcripts_enabled', value: 'true', source: 'default', editable: false },
];

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: { instance, instanceReadable: true, aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: true, ...overrides },
			form,
		} as never,
	});
}

describe('AI settings page', () => {
	it('shows both switches with the plain words under the tenant switch', () => {
		const { getByTestId, getByLabelText } = setup();
		expect(getByLabelText('AI for this tenant').getAttribute('aria-checked')).toBe('true');
		expect(getByLabelText('Store transcripts').getAttribute('aria-checked')).toBe('true');
		const words = getByTestId('what-never-leaves').textContent ?? '';
		expect(words).toContain('The only bytes that leave are the request to the endpoint you configured');
		expect(words).toContain('LyEve Labs never sees your prompts');
		expect(words).toContain('Nothing is anonymized');
	});

	it('posts the opposite of the current value for the one switch named', () => {
		const { getByTestId } = setup();
		const enabled = getByTestId('ai-enabled-form');
		expect((enabled.querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe('false');
		expect(enabled.querySelector('input[name="transcripts_enabled"]')).toBeNull();
		const transcripts = getByTestId('ai-transcripts-form');
		expect((transcripts.querySelector('input[name="transcripts_enabled"]') as HTMLInputElement).value).toBe('false');
		expect(transcripts.querySelector('input[name="enabled"]')).toBeNull();
	});

	it('stays reachable while the tenant is off and shows the switch off', () => {
		const { getByLabelText, queryByText } = setup({ aiSettings: { ...fixtureSettings, enabled: false }, aiLayoutGate: { state: 'ok' } });
		expect(getByLabelText('AI for this tenant').getAttribute('aria-checked')).toBe('false');
		expect(getByLabelText('Store transcripts').hasAttribute('disabled')).toBe(true);
		expect(queryByText('AI is switched off for this tenant')).toBeNull();
	});

	it('offers the retention row to a super admin when the value is editable', () => {
		const { getByLabelText, getByText } = setup();
		expect((getByLabelText('Retention') as HTMLInputElement).value).toBe('720h');
		expect(getByText(/thirty days/)).toBeTruthy();
	});

	it('tells a tenant admin where retention is set', () => {
		const { getByText, queryByLabelText } = setup({ isSuperAdmin: false, instanceReadable: false });
		expect(queryByLabelText('Retention')).toBeNull();
		expect(getByText(/A super admin sets the window/)).toBeTruthy();
	});

	it('paints the locked and the absent states with no switch', () => {
		const locked = setup({ aiSettings: null, aiLayoutGate: { state: 'locked' } });
		expect(locked.getByText('Not enabled on this instance.')).toBeTruthy();
		expect(locked.queryByLabelText('AI for this tenant')).toBeNull();
		cleanup();
		const absent = setup({ aiSettings: null, aiLayoutGate: { state: 'absent' } });
		expect(absent.getByText('The AI plugin is not installed')).toBeTruthy();
	});
});
